(() => {
  'use strict';
  const M = window.ReportModel, data = window.REPORT_DATA;
  const $ = id => document.getElementById(id);
  if (!M || !data) { $('panel-results').textContent = 'Не удалось загрузить отчёт. Обновите страницу.'; return; }
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const paragraphsHTML = value => String(value ?? '').split(/\r?\n\s*\r?\n/).filter(p => p.trim()).map(p => `<p>${esc(p)}</p>`).join('');
  const strongHTML = value => esc(value).replace(/\*\*([^*\r\n]+)\*\*/g, '<strong>$1</strong>');
  const detailParagraphsHTML = value => String(value ?? '').split(/\r?\n\s*\r?\n/).filter(p => p.trim()).map(p => `<p>${strongHTML(p)}</p>`).join('');
  const number = value => new Intl.NumberFormat('ru-RU',{maximumFractionDigits:1}).format(value);
  const dateLabel = value => value ? new Intl.DateTimeFormat('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date(value + 'T12:00:00Z')) : '';
  const icon = (name, cls = '') => `<svg class="${cls}" width="20" height="20" aria-hidden="true" viewBox="0 0 24 24">${{
    arrow:'<path d="M5 12h14m-5-5 5 5-5 5"/>', chevron:'<path d="m9 5 7 7-7 7"/>',
    external:'<path d="M7 17 17 7M7 7h10v10"/>', work:'<rect x="5" y="5" width="14" height="16" rx="2"/><path d="M9 5V3h6v2m-6 6h6m-6 5h6"/>',
    chart:'<path d="M4 3v17h17M9 15v-4m5 4V6m5 9V9"/>', up:'<path d="M12 20V4m-6 6 6-6 6 6"/>', down:'<path d="M12 4v16m-6-6 6 6 6-6"/>'
  }[name] || ''}</svg>`;
  const tabs = ['results','works'], months = M.months(data), dialog = $('detail-dialog');
  const hasWorkDetails = month => month >= '2026-10';
  const state = {month:M.defaultMonth(data),tab:'results',detail:null,filters:{search:'',direction:'',trend:'all',cohort:'all'},limit:25,engine:'yandex'};
  let view = null, report = null, positionColumns = null, renderedMonth = null, currentDetail = null, lastOpener = null;
  const linkHTML = item => M.safeHref(item.url) ? `<a href="${esc(M.safeHref(item.url))}" target="_blank" rel="noopener noreferrer">${esc(item.label || item.url)}${icon('external')}</a>` : esc(item.label || 'Ссылка недоступна');
  function readRoute() {
    const url = new URL(location.href), month = url.searchParams.get('month'), tab = url.hash.slice(1);
    return {month:months.includes(month) ? month : M.defaultMonth(data), tab:tabs.includes(tab) ? tab : 'results', detail:url.searchParams.get('work')};
  }
  function routeURL() {
    const url = new URL(location.href);
    url.searchParams.set('month',state.month); url.searchParams.delete('task');
    if (state.detail) url.searchParams.set('work',state.detail); else url.searchParams.delete('work');
    url.hash = state.tab; return url;
  }
  function navigate(changes, {replace = false, focusTab = false} = {}) {
    if (changes.month && changes.month !== state.month) { state.filters = {search:'',direction:'',trend:'all',cohort:'all'}; state.limit = 25; }
    Object.assign(state, changes);
    if (state.detail && (state.tab !== 'works' || !hasWorkDetails(state.month) || !M.getReport(data,state.month)?.works.some(w => w.id === state.detail))) state.detail = null;
    try { history[replace ? 'replaceState' : 'pushState'](null,'',routeURL()); } catch (_) {}
    render(); if (focusTab) $('tab-' + state.tab).focus({preventScroll:true});
  }
  function pendingHTML(kind) {
    const heading = kind === 'works' ? 'Работы за этот месяц ещё не добавлены' : 'Позиции за этот месяц ещё не добавлены';
    const text = kind === 'works' ? 'Будем добавлять выполненные работы по мере готовности. Итоги месяца появятся после его завершения.' : 'Здесь появятся сохранённые замеры Яндекса и Google с фактическими датами проверки.';
    return `<div class="empty-state surface"><div class="empty-symbol">${icon(kind === 'works' ? 'work' : 'chart')}</div><div><h2>${heading}</h2><p>${text}</p></div></div>`;
  }
  function kpiHTML(engine, top) {
    if (report.archive) {
      const metric = report.archive.kpis[engine]['top' + top];
      const before = metric.before.replace(/^Было:\s*/i,'').trim(), after = metric.after.replace(/^Стало:\s*/i,'').trim();
      return `<div class="engine-kpi-metric"><h4>Топ-${top}</h4><div class="kpi-values"><div><span class="kpi-period">Было</span><span class="number before">${esc(before)}</span></div>${icon('arrow','kpi-arrow')}<div><span class="kpi-period">Стало</span><span class="number neutral">${esc(after)}</span></div></div><p class="kpi-count archive-change">${esc(metric.change)}</p></div>`;
    }
    const stats = view?.stats[engine], metric = stats?.['top' + top];
    if (!stats?.total) return `<div class="engine-kpi-metric"><h4>Топ-${top}</h4><p class="no-metric">Нет данных</p></div>`;
    const after = metric.after / stats.total * 100, before = metric.before === null ? null : metric.before / stats.total * 100;
    const trend = before === null || after === before ? 'neutral' : after > before ? 'positive' : 'negative';
    return `<div class="engine-kpi-metric"><h4>Топ-${top}</h4><div class="kpi-values">${before === null ? '' : `<div><span class="kpi-period">Было</span><span class="number before">${number(metric.before)}</span></div>${icon('arrow','kpi-arrow')}`}<div>${before === null ? '' : '<span class="kpi-period">Стало</span>'}<span class="number ${trend}">${number(metric.after)}</span></div></div><p class="kpi-count">из ${number(stats.total)} запросов · ${number(after)}%</p></div>`;
  }
  function engineKpisHTML() {
    return `<div class="engine-kpi-grid">${M.ENGINES.map(engine => `<section class="engine-kpi-card surface engine-${engine}" aria-labelledby="kpi-heading-${engine}"><h3 class="searcher-name" id="kpi-heading-${engine}">${engine === 'yandex' ? 'Яндекс' : 'Google'}</h3><div class="engine-kpi-metrics">${[10,3].map(top => kpiHTML(engine,top)).join('')}</div></section>`).join('')}</div>`;
  }
  function rankCharts() {
    const archive = report.archive;
    if (!archive && !view) return '';
    const percent = text => Number.parseFloat(text.replace(/^.*?:\s*/,'').replace(',','.'));
    const stats = archive ? Object.fromEntries(M.ENGINES.map(engine => [engine, Object.fromEntries([3,10].map(top => ['top' + top, {
      before:percent(archive.kpis[engine]['top' + top].before), after:percent(archive.kpis[engine]['top' + top].after)
    }]))])) : view.stats;
    const max = Math.max(1, ...Object.values(stats).flatMap(s => [s.top3.before,s.top3.after,s.top10.before,s.top10.after].filter(Number.isFinite)));
    return `<div class="charts-grid">${M.ENGINES.map(engine => {
      const s = stats[engine], comparable = archive || s.comparable;
      if (!archive && !s.total) return '';
      const bars = [3,10].map(top => `<div class="rank-bar-group">${['before','after'].map(side => {
        const value = s['top' + top][side];
        return Number.isFinite(value) ? `<div class="rank-bar ${side}" style="height:${value / max * 104}px"><span>${number(value)}${archive ? '%' : ''}</span></div>` : '';
      }).join('')}<strong>Топ-${top}</strong></div>`).join('');
      const name = engine === 'yandex' ? 'Яндекс' : 'Google';
      return `<section class="ranking-chart surface" aria-label="${name}: ${archive ? 'доли запросов по архивной сводке' : 'количество запросов'}"><h3>${name}</h3>${archive ? '<p class="archive-chart-note">Доли запросов по сводке архивного отчёта</p>' : ''}<div class="rank-bars">${bars}</div><div class="chart-legend">${comparable ? `<span><i class="before-key"></i>Было${archive ? '' : ' · ' + dateLabel(view.before.date)}</span>` : ''}<span><i></i>${comparable ? 'Стало' : 'Сейчас'}${archive ? '' : ' · ' + dateLabel(view.after.date)}</span></div></section>`;
    }).join('')}</div>`;
  }
  function trafficHTML() {
    if (!report.traffic) return '';
    const t = report.traffic, period = value => value ? `${dateLabel(value.from).slice(0,5)}–${dateLabel(value.to).slice(0,5)}` : '';
    const cards = [{label:'Поисковый трафик',current:t.visits,previous:t.previousVisits},
      ...[['google','Google'],['yandex','Яндекс']].filter(([key]) => t.engines?.[key]).map(([key,label]) => ({label,...t.engines[key]}))];
    const delta = (current,previous) => {
      if (!Number.isFinite(previous)) return '';
      const percent = previous > 0 ? (current - previous) / previous * 100 : null, trend = current > previous ? 'positive' : current < previous ? 'negative' : 'neutral';
      return `<p class="traffic-change ${trend}">${percent === null ? 'Нет базы для процента' : `${percent > 0 ? '+' : ''}${number(percent)}%`}<span>было ${number(previous)}</span></p>`;
    };
    const weekly = t.weekly || [];
    let chart = '';
    if (weekly.length) {
      const maximum = Math.max(1,...weekly.map(w => w.visits)), axisMax = Math.ceil(maximum / 20) * 20;
      const series = [['visits','Все поисковики'],['google','Google'],['yandex','Яндекс']];
      const chartSVG = (variant,width,height,left) => {
        const right = 12, top = 20, bottom = 34, plotWidth = width - left - right, plotHeight = height - top - bottom;
        const x = i => left + i / Math.max(1,weekly.length - 1) * plotWidth, y = value => top + plotHeight - value / axisMax * plotHeight;
        const grid = [0,.5,1].map(ratio => `<line x1="${left}" y1="${y(axisMax * ratio)}" x2="${width - right}" y2="${y(axisMax * ratio)}" class="traffic-grid-line"/><text x="${left - 8}" y="${y(axisMax * ratio) + 4}" text-anchor="end">${number(axisMax * ratio)}</text>`).join('');
        const lines = series.map(([key,label]) => `<polyline class="traffic-line traffic-line-${key}" points="${weekly.map((week,i) => `${x(i)},${y(week[key])}`).join(' ')}"/>${weekly.map((week,i) => `<circle class="traffic-point traffic-point-${key}" cx="${x(i)}" cy="${y(week[key])}" r="2.6"><title>${esc(label)} · ${period(week)}: ${number(week[key])} визитов</title></circle>`).join('')}`).join('');
        const labels = [...new Set([0,Math.floor((weekly.length - 1) / 3),Math.floor((weekly.length - 1) * 2 / 3),weekly.length - 1])].map(i => `<text x="${x(i)}" y="${height - 9}" text-anchor="${i === 0 ? 'start' : i === weekly.length - 1 ? 'end' : 'middle'}">${dateLabel(weekly[i].from).slice(0,5)}</text>`).join('');
        return `<svg class="traffic-chart traffic-chart-${variant}" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="traffic-chart-title-${variant} traffic-chart-description-${variant}"><title id="traffic-chart-title-${variant}">Поисковый трафик за ${weekly.length} недель</title><desc id="traffic-chart-description-${variant}">Количество визитов из всех поисковиков, Google и Яндекса. Точные значения по неделям доступны в таблице под графиком.</desc>${grid}${lines}${labels}</svg>`;
      };
      chart = `<div class="traffic-history"><h3>Поисковый трафик по неделям</h3><p class="traffic-chart-period">${period({from:weekly[0].from,to:weekly.at(-1).to})} · визиты</p>${chartSVG('desktop',780,240,42)}${chartSVG('mobile',320,210,38)}<div class="traffic-legend">${series.map(([key,label]) => `<span><i class="traffic-key traffic-key-${key}"></i>${label}</span>`).join('')}</div><details class="traffic-data"><summary>Данные по неделям</summary><div class="table-scroll" tabindex="0" role="region" aria-label="Трафик по неделям"><table class="evidence-table"><thead><tr><th scope="col">Неделя</th><th scope="col">Всего</th><th scope="col">Google</th><th scope="col">Яндекс</th><th scope="col">Другие</th></tr></thead><tbody>${weekly.map(week => `<tr><th scope="row">${period(week)}</th>${['visits','google','yandex','other'].map(key => `<td>${number(week[key])}</td>`).join('')}</tr>`).join('')}</tbody></table></div></details></div>`;
    }
    return `<section class="traffic-section surface" aria-label="Поисковый трафик"><div class="section-heading"><h2>Поисковый трафик</h2></div>${t.period ? `<p class="traffic-period">${period(t.period)}${t.comparisonPeriod ? ` по сравнению с ${period(t.comparisonPeriod)}` : ''}</p>` : ''}<div class="traffic-kpis">${cards.map(card => `<div class="traffic-metric"><h3>${esc(card.label)}</h3><p class="traffic-value">${number(card.current)}<span>визитов</span></p>${delta(card.current,card.previous)}</div>`).join('')}</div>${chart}<p class="source-label">${esc(t.sourceLabel || '')}${t.attribution ? ` · ${esc(t.attribution)}` : ''}</p>${t.note ? `<p class="traffic-context">${esc(t.note)}</p>` : ''}</section>`;
  }
  function rankCell(value, archive = false, observation = {}) {
    if (observation.status === 'error') return '<span class="rank-missing rank-error" title="Проверка не завершилась. Это не потеря позиции.">Ошибка замера</span>';
    if (value === undefined || (archive && (value === null || value === ''))) return '<span class="rank-missing">Нет замера</span>';
    if (value === null) {
      const label = observation.depth ? `Сайт не найден в первых ${observation.depth} результатах` : 'Сайт не найден в результатах проверки';
      return `<span class="rank-value rank-out" aria-label="${label}" title="${label}">—</span>`;
    }
    const numeric = Number(value), band = numeric > 0 && numeric <= 3 ? 'top3' : numeric <= 10 && numeric > 0 ? 'top10' : numeric <= 30 && numeric > 0 ? 'top30' : 'other';
    return `<span class="rank-value rank-${band}">${archive ? esc(value) : number(value)}</span>`;
  }
  function deltaHTML(change) {
    const labels = {appeared:'Появился',lost:'За пределами',same:'Без изменений',no_data:'Не сравниваем',new:'Новый запрос'};
    if (['up','down'].includes(change.kind)) return `<span class="delta ${change.kind === 'up' ? 'positive' : 'negative'}" aria-label="${change.kind === 'up' ? 'Рост' : 'Снижение'} на ${change.amount}">${icon(change.kind)}${number(change.amount)}</span>`;
    return `<span class="delta ${change.kind === 'appeared' ? 'positive' : change.kind === 'lost' ? 'negative' : 'neutral'}">${labels[change.kind]}</span>`;
  }
  function queryTableHTML() {
    if (!report.archive && !view) return '';
    const archive = report.archive, rows = archive ? archive.rows : view.rows;
    const directions = [...new Set(rows.map(r => r.direction).filter(Boolean))].sort((a,b) => a.localeCompare(b,'ru'));
    const labels = {start:'Старт',before:'Прошлый месяц',after:'Сейчас'};
    const shortLabels = {start:'Старт',before:'Было',after:'Стало'};
    positionColumns = Object.fromEntries(M.ENGINES.map(engine => [engine, archive ? archive.dates[engine].map((d,i,dates) => ({...d,key:i,role:i === dates.length - 1 ? 'after' : i === 0 ? 'start' : 'before'})) :
      ['start','before','after'].filter(role => view[role] && (role !== 'start' || view.start.date !== view.after.date)).map(role => ({key:role,role,date:view[role].date}))]));
    const counts = Object.fromEntries(M.ENGINES.map(e => [e,positionColumns[e].length]));
    const heading = engine => positionColumns[engine].map((column,i) => `<th id="rank-${engine}-${column.key}" scope="col" class="engine-${engine} period-${column.role} ${i === 0 ? 'engine-start' : ''} ${column.role === 'after' ? 'current' : ''}" aria-label="${labels[column.role]}, ${dateLabel(column.date)}"><span class="rank-label-long">${labels[column.role]}</span><span class="rank-label-short" aria-hidden="true">${shortLabels[column.role]}</span><time datetime="${column.date}" aria-label="${dateLabel(column.date)}"><span class="rank-date-full">${dateLabel(column.date)}</span><span class="rank-date-short" aria-hidden="true">${dateLabel(column.date).slice(0,5)}</span></time></th>`).join('');
    const columns = M.ENGINES.map(engine => positionColumns[engine].map(() => `<col class="rank-col engine-${engine}">`).join('')).join('');
    const depths = !archive ? M.ENGINES.map(engine => [engine === 'yandex' ? 'Яндекс' : 'Google',view.after.engines?.[engine]?.depth]).filter(([,depth]) => depth).map(([label,depth]) => `${label} — ${depth}`).join(', ') : '';
    const method = archive ? '«Нет замера» — нет данных за эту дату.' : `«—» — сайт не найден в пределах проверки${depths ? ` (${depths} результатов)` : ''}. «Нет замера» и «Ошибка замера» не считаются потерей позиции. Стрелки показывают изменение к прошлому месяцу. Новые запросы не включаем в сравнение.`;
    const cohorts = report.rankings?.cohorts || [], downloads = report.rankings?.downloads || [];
    const cohortFilter = cohorts.length ? `<div class="filter-field cohort"><label for="cohort-filter">Выборка запросов</label><div class="select-wrap"><select id="cohort-filter"><option value="all">Все ${rows.length} запросов</option>${cohorts.filter(c => c.id !== 'all').map(c => `<option value="${esc(c.id)}">${esc(c.label)}</option>`).join('')}</select>${icon('chevron')}</div></div>` : '';
    const legend = `<div class="rank-legend" aria-label="Обозначения текущих позиций"><span>Текущие позиции:</span><span><i class="rank-key rank-top3" aria-hidden="true"></i>Топ-3</span><span><i class="rank-key rank-top10" aria-hidden="true"></i>4–10</span><span><i class="rank-key rank-top30" aria-hidden="true"></i>11–30</span><span><i class="rank-key rank-other" aria-hidden="true"></i>31 и ниже</span></div>`;
    return `<section class="queries-card surface"><div class="section-heading"><h2>Позиции запросов</h2>${downloads.length ? `<div class="ranking-downloads">${downloads.map(linkHTML).join('')}</div>` : ''}</div><div class="table-filters"><div class="filter-field search"><label for="query-search">Найти запрос</label><input id="query-search" type="search" placeholder="Например, косметология Сургут" value="${esc(state.filters.search)}"></div>${cohortFilter}<div class="filter-field direction"><label for="direction-filter">Направление</label><div class="select-wrap"><select id="direction-filter"><option value="">Все направления</option>${directions.map(d => `<option value="${esc(d)}">${esc(d)}</option>`).join('')}</select>${icon('chevron')}</div></div>${!archive && view.before ? `<div class="filter-field trend"><label for="trend-filter">Динамика за месяц</label><div class="select-wrap"><select id="trend-filter">${[['all','Все изменения'],['up','Рост'],['down','Снижение'],['same','Без изменений'],['new','Новые запросы']].map(([v,label]) => `<option value="${v}">${label}</option>`).join('')}</select>${icon('chevron')}</div></div>` : ''}</div>${legend}<div class="mobile-engine" role="group" aria-label="Поисковик в таблице"><button type="button" data-engine="yandex" aria-pressed="${state.engine === 'yandex'}">Яндекс</button><button type="button" data-engine="google" aria-pressed="${state.engine === 'google'}">Google</button></div><p class="table-scroll-hint">Проведите по таблице влево, чтобы увидеть текущие позиции.</p><div class="table-scroll" id="positions-wrap" data-engine="${state.engine}" role="region" tabindex="0" aria-label="Позиции запросов"><table class="positions-table snapshot-positions" style="--rank-columns:${counts.yandex + counts.google};--yandex-columns:${counts.yandex};--google-columns:${counts.google}"><caption class="sr-only">Позиции запросов за ${esc(M.monthLabel(state.month).toLowerCase())}: старт, прошлый месяц и текущий замер</caption><colgroup><col class="query-col">${columns}</colgroup><thead><tr><th id="query-heading" rowspan="2" scope="col" class="query-heading">Запрос</th><th id="engine-yandex" colspan="${counts.yandex}" scope="colgroup" class="engine-yandex engine-title engine-start">Яндекс</th><th id="engine-google" colspan="${counts.google}" scope="colgroup" class="engine-google engine-title engine-start">Google</th></tr><tr>${M.ENGINES.map(heading).join('')}</tr></thead><tbody id="query-rows"></tbody></table></div><p id="query-empty" class="query-empty" hidden>Запросы не найдены. Измените поиск или фильтры.</p><div class="table-footer"><span id="query-count" role="status" aria-live="polite"></span><button type="button" class="button-secondary" id="show-more">Показать ещё 25</button></div><p class="table-method">${method}</p>${archive ? '' : `<p class="rank-sources">Источники: ${view.before ? `${dateLabel(view.before.date)} — ${esc(view.before.sourceLabel || '')}; ` : ''}${dateLabel(view.after.date)} — ${esc(view.after.sourceLabel || '')}.</p>`}</section>`;
  }
  function renderQueries() {
    if (!$('query-rows')) return;
    const archive = report.archive, allRows = archive ? archive.rows : view.rows;
    const filtered = M.filterRows(allRows,state.filters,report.rankings?.cohorts), visible = filtered.slice(0,state.limit);
    $('query-rows').innerHTML = visible.map((row,rowIndex) => `<tr><th id="query-${rowIndex}" scope="row" class="query-name">${esc(row.query)}</th>${M.ENGINES.map(engine => positionColumns[engine].map((column,i) => {
      const value = row[engine][column.key], change = !archive && column.role === 'after' && row[engine].change;
      const movement = change && ['up','down','appeared','lost','new'].includes(change.kind) ? `<span class="rank-movement">${deltaHTML(change)}</span>` : '';
      return `<td headers="query-${rowIndex} engine-${engine} rank-${engine}-${column.key}" class="engine-${engine} period-${column.role} ${i === 0 ? 'engine-start' : ''} ${column.role === 'after' ? 'current' : ''}">${rankCell(value,!!archive,row[engine].observations?.[column.role])}${movement}</td>`;
    }).join('')).join('')}</tr>`).join('');
    $('positions-wrap').hidden = filtered.length === 0; $('query-empty').hidden = filtered.length !== 0;
    $('query-count').textContent = `Показано: ${visible.length} из ${filtered.length}${filtered.length === allRows.length ? '' : ` · всего ${allRows.length} запросов`}`; $('show-more').hidden = state.limit >= filtered.length;
  }
  function resultsHTML() {
    view = M.rankingsView(report.rankings);
    let intro = report.intro.map(paragraphsHTML).join('');
    if (report.conclusions.length) intro += '<p class="archive-conclusion-title">Выводы</p>' + report.conclusions.map(paragraphsHTML).join('');
    const stateNote = !report.archive && view ? `${report.status === 'in_progress' ? 'Промежуточные данные. Итоговый отчёт будет подготовлен в конце месяца. ' : ''}Замеры позиций: ${view.before ? dateLabel(view.before.date) + ' — ' : ''}${dateLabel(view.after.date)}. ${esc(view.after.region)}, смартфоны.` : '';
    const note = view?.before && !view.metaMatch ? '<p class="metrics-note">Настройки замеров различаются. Динамику не сравниваем.</p>' : '';
    return `<div class="results-heading"><h2>Результаты за ${M.monthLabel(state.month).toLowerCase()}</h2>${intro}${stateNote ? `<p class="report-state">${stateNote}</p>` : ''}</div>${report.archive || view ? engineKpisHTML() + note + rankCharts() + trafficHTML() + queryTableHTML() : trafficHTML() + pendingHTML('results')}`;
  }
  function worksHTML() {
    if (!report.works.length) return pendingHTML('works');
    const details = hasWorkDetails(state.month);
    return `<div class="works-heading"><h2>Работы за ${M.monthLabel(state.month).toLowerCase()}</h2></div><section class="surface"><table class="works-table${details ? '' : ' without-details'}"><thead><tr><th scope="col">Что сделали</th><th scope="col">Краткое описание</th><th scope="col">Для чего это нужно</th>${details ? '<th scope="col">Подробнее</th>' : ''}</tr></thead><tbody>${report.works.map(work => `<tr><td><h3 class="work-name">${esc(work.title)}</h3></td><td class="work-summary">${esc(work.summary)}</td><td data-label="Для чего это нужно">${work.why ? paragraphsHTML(work.why) : '—'}</td>${details ? `<td><button type="button" class="work-open" data-work="${esc(work.id)}" aria-label="Подробнее: ${esc(work.title)}">Подробнее${icon('arrow')}</button></td>` : ''}</tr>`).join('')}</tbody></table></section>`;
  }
  function tableHTML(item, emphasize = false) {
    const isUrlMap = item.rows.length > 0 && item.rows.every(row => row.length === 3 && [row[1],row[2]].every(value => typeof value === 'string' && value.startsWith('/')));
    const content = emphasize ? strongHTML : esc;
    return `<div class="table-scroll" role="region" aria-label="${esc(item.label)}"${isUrlMap ? '' : ' tabindex="0"'}><table class="evidence-table${isUrlMap ? ' evidence-url-map' : ''}" role="table"><thead role="rowgroup"><tr role="row">${item.columns.map(c => `<th scope="col" role="columnheader">${content(c)}</th>`).join('')}</tr></thead><tbody role="rowgroup">${item.rows.map(row => `<tr role="row">${item.columns.map((column,i) => `<td data-label="${esc(column)}" role="cell">${isUrlMap && i > 0 ? content(row[i]).replaceAll('/','/<wbr>').replaceAll('-','-<wbr>') : content(row[i])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }
  function evidenceHTML(item) {
    if (item.type === 'link') return `<p class="detail-resource">${linkHTML(item)}</p>`;
    let body = '';
    const hasImages = item.type === 'comparison' && M.safeImageHref(item.beforeImage) && M.safeImageHref(item.afterImage);
    if (item.type === 'comparison') {
      const sideHTML = (side,label) => `<div><h4>${label}</h4>${item[side] ? `<p>${esc(item[side])}</p>` : ''}${hasImages ? `<figure class="comparison-screenshot"><a href="${esc(item[side + 'Image'])}" target="_blank" rel="noopener noreferrer" aria-label="${label}: открыть снимок в полном размере"><img src="${esc(item[side + 'Image'])}" alt="${esc(item[side + 'Alt'])}" loading="lazy" decoding="async"></a><figcaption>Нажмите на снимок, чтобы открыть его в полном размере.</figcaption></figure>` : ''}</div>`;
      body = `<div class="comparison-grid${hasImages ? ' has-images' : ''}">${sideHTML('before','Было')}${sideHTML('after','Стало')}</div>`;
    }
    if (item.type === 'table') body = tableHTML(item);
    return `<details class="evidence-block"${hasImages || item.type === 'table' ? ' open' : ''}><summary>${esc(item.label)}</summary><div class="evidence-content">${body}</div></details>`;
  }
  function sectionHTML(section) {
    return `<section class="detail-section">${section.title?.trim() ? `<h3>${esc(section.title)}</h3>` : ''}${detailParagraphsHTML(section.text)}${section.bullets?.length ? `<ul>${section.bullets.map(b => `<li>${strongHTML(b)}</li>`).join('')}</ul>` : ''}${section.table ? tableHTML({...section.table,label:section.table.label || section.title || 'Таблица'},true) : ''}${detailParagraphsHTML(section.afterText)}${section.links?.length ? `<ul class="detail-links">${section.links.map(l => `<li>${linkHTML(l)}</li>`).join('')}</ul>` : ''}</section>`;
  }
  function renderDetail() {
    const work = state.tab === 'works' && hasWorkDetails(state.month) && report.works.find(w => w.id === state.detail);
    const key = work ? `${state.month}:${work.id}` : null;
    if (!work) {
      if (dialog.open) { dialog.close(); document.body.classList.remove('dialog-open'); (lastOpener?.isConnected ? lastOpener : $('tab-' + state.tab)).focus({preventScroll:true}); }
      currentDetail = null; return;
    }
    if (key === currentDetail && dialog.open) return;
    dialog.dataset.reportView = 'works'; $('detail-title').textContent = work.title; $('detail-meta').hidden = true;
    const sections = (work.sections || []).map(sectionHTML).join('');
    $('detail-body').innerHTML = `<section class="actual-result"><h3>Что сделали</h3>${detailParagraphsHTML(work.result)}${work.resultBullets?.length ? `<ul class="result-bullets">${work.resultBullets.map(b => `<li>${strongHTML(b)}</li>`).join('')}</ul>` : ''}${sections}${(work.evidence || []).map(evidenceHTML).join('')}</section>`;
    if (!dialog.open) { dialog.showModal(); document.body.classList.add('dialog-open'); }
    $('detail-body').scrollTop = 0; $('close-detail').focus({preventScroll:true}); currentDetail = key;
  }
  function render() {
    report = M.getReport(data,state.month); $('report-month').value = state.month;
    if (renderedMonth !== state.month) { $('panel-results').innerHTML = resultsHTML(); $('panel-works').innerHTML = worksHTML(); renderedMonth = state.month; }
    for (const tab of tabs) { $('tab-' + tab).setAttribute('aria-selected',String(state.tab === tab)); $('tab-' + tab).tabIndex = state.tab === tab ? 0 : -1; $('panel-' + tab).hidden = state.tab !== tab; }
    $('work-count').hidden = !report.works.length; $('work-count').textContent = report.works.length;
    document.title = `Отчёт по продвижению сайта «${data.project.name}» — ${M.monthLabel(state.month)}`;
    renderQueries(); renderDetail();
  }
  $('report-client').textContent = `«${data.project.name}»`;
  $('site-link').href = M.safeHref(data.project.website); $('site-link').innerHTML = esc(new URL(data.project.website).hostname) + icon('external');
  $('period-label').textContent = `${M.monthLabel(months[0])} — ${M.monthLabel(months.at(-1)).toLowerCase()}`;
  $('report-month').innerHTML = months.map(month => `<option value="${month}">${M.monthLabel(month)}</option>`).join('');
  $('report-month').addEventListener('change',event => { navigate({month:event.target.value,detail:null}); $('announcement').textContent = `Выбран ${M.monthLabel(state.month)}.`; });
  tabs.forEach((tab,index) => {
    $('tab-' + tab).addEventListener('click',() => navigate({tab,detail:null}));
    $('tab-' + tab).addEventListener('keydown',event => {
      if (event.ctrlKey || event.metaKey || event.altKey || !['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
      event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      navigate({tab:tabs[next],detail:null},{focusTab:true});
    });
  });
  document.addEventListener('click',event => {
    const work = event.target.closest('[data-work]'); if (work) { lastOpener = work; navigate({detail:work.dataset.work}); return; }
    const engine = event.target.closest('button[data-engine]');
    if (engine) { state.engine = engine.dataset.engine; $('positions-wrap').dataset.engine = state.engine; document.querySelectorAll('button[data-engine]').forEach(b => b.setAttribute('aria-pressed',String(b.dataset.engine === state.engine))); return; }
    if (event.target.closest('#show-more')) { state.limit += 25; renderQueries(); }
  });
  document.addEventListener('input',event => { if (event.target.id === 'query-search') { state.filters.search = event.target.value; state.limit = 25; renderQueries(); } });
  document.addEventListener('change',event => {
    if (event.target.id === 'direction-filter') state.filters.direction = event.target.value;
    else if (event.target.id === 'trend-filter') state.filters.trend = event.target.value;
    else if (event.target.id === 'cohort-filter') state.filters.cohort = event.target.value; else return;
    state.limit = 25; renderQueries();
  });
  $('close-detail').addEventListener('click',() => navigate({detail:null}));
  dialog.addEventListener('cancel',event => { event.preventDefault(); navigate({detail:null}); });
  dialog.addEventListener('click',event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) navigate({detail:null}); } });
  function restoreRoute() { navigate(readRoute(),{replace:true}); }
  window.addEventListener('popstate',restoreRoute); window.addEventListener('hashchange',restoreRoute);
  navigate(readRoute(),{replace:true});
})();
