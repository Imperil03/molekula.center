(function (root, factory) {
  const model = factory();
  if (typeof module === 'object' && module.exports) module.exports = model;
  else root.ReportModel = model;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const ENGINES = ['yandex', 'google'];
  const MONTHS = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
  const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
  const monthLabel = (month, year = true) => `${MONTHS[Number(month.slice(5)) - 1]}${year ? ' ' + month.slice(0,4) : ''}`;
  const months = data => data.reports.map(r => r.month).sort();
  const getReport = (data, month) => data.reports.find(r => r.month === month) || null;
  const defaultMonth = data => months(data).includes(data.project.currentMonth) ? data.project.currentMonth : months(data).at(-1);
  const normalize = value => String(value ?? '').toLocaleLowerCase('ru-RU').trim().replace(/\s+/g, ' ');
  function safeHref(value) {
    if (typeof value !== 'string') return null;
    if (/^evidence\/[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(value) && !value.split('/').includes('..')) return value;
    try { const url = new URL(value); if (url.protocol === 'https:' && !url.username && !url.password) return url.href; } catch (_) {}
    return null;
  }
  function safeImageHref(value) {
    return typeof value === 'string' && value.startsWith('evidence/') && /\.(png|jpe?g|webp)$/.test(value) && safeHref(value) === value ? value : null;
  }
  function validDate(value) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      !Number.isNaN(Date.parse(value)) && new Date(value + 'T12:00:00Z').toISOString().slice(0,10) === value;
  }
  function rankChange(before, after, comparable, isNew = false) {
    if (!comparable || after === undefined) return {kind:'no_data', amount:null};
    if (isNew || before === undefined) return {kind:'new', amount:null};
    if (before === null && after === null) return {kind:'same', amount:0};
    if (before === null) return {kind:'appeared', amount:null};
    if (after === null) return {kind:'lost', amount:null};
    return {kind:before > after ? 'up' : before < after ? 'down' : 'same', amount:Math.abs(before - after)};
  }
  function settingsContext(snapshot, engine) {
    if (!snapshot) return null;
    const meta = snapshot.engines?.[engine] || {};
    const device = value => ['2','смартфон','смартфоны','smartphone','mobile'].includes(normalize(value)) ? 'mobile' : normalize(value);
    return {engine, searcher:String(meta.searcher ?? (engine === 'yandex' ? 0 : 1)),
      region:normalize(meta.region ?? snapshot.region), regionId:meta.regionId == null ? null : String(meta.regionId),
      index:meta.index == null ? null : String(meta.index), device:device(meta.device ?? snapshot.device),
      language:normalize(meta.language ?? meta.lang ?? 'ru'), depth:meta.depth == null ? null : Number(meta.depth)};
  }
  function sameSettings(before, after, engine) {
    const a = settingsContext(before,engine), b = settingsContext(after,engine);
    if (!a || !b) return false;
    return ['engine','searcher','region','device','language'].every(key => a[key] === b[key]) &&
      ['regionId','index','depth'].every(key => a[key] === null || b[key] === null || a[key] === b[key]);
  }
  function observation(snapshot, row, engine) {
    const saved = row?.observations?.[engine];
    const status = saved?.status || (!row || !own(row,engine) ? 'missing' : row[engine] === null ? 'not_found' : 'found');
    const value = status === 'found' ? row?.[engine] : status === 'not_found' ? null : undefined;
    return {...saved, status, value, depth:saved?.depth ?? snapshot?.engines?.[engine]?.depth,
      checkedAt:saved?.checkedAt ?? snapshot?.engines?.[engine]?.checkedAt ?? snapshot?.date};
  }
  function rankingsView(rankings) {
    if (!rankings?.after) return null;
    const {start, before, after} = rankings;
    const matches = Object.fromEntries(ENGINES.map(e => [e, sameSettings(before, after, e)]));
    const beforeMap = new Map((before?.rows || []).map(r => [r.id, r]));
    const startMap = new Map((start?.rows || []).map(r => [r.id, r]));
    const afterMap = new Map(after.rows.map(r => [r.id, r]));
    const rows = [...new Set([...afterMap.keys(), ...beforeMap.keys()])].map(id => {
      const old = beforeMap.get(id), current = afterMap.get(id), display = current || old;
      const renamed = !!(old && current && normalize(old.query) !== normalize(current.query));
      const isNew = !!before && (!old || renamed || ENGINES.every(e => !own(old, e)));
      const row = {id, query:display.query, direction:display.direction || '', isNew, removed:!current};
      for (const engine of ENGINES) {
        const beforeObservation = observation(before,renamed ? null : old,engine), afterObservation = observation(after,current,engine);
        const previous = beforeObservation.value;
        const initial = startMap.get(id);
        const initialMatches = initial && normalize(initial.query) === normalize(display.query) && sameSettings(start,after,engine);
        const startObservation = observation(start,initialMatches ? initial : null,engine);
        row[engine] = {start:startObservation.value, before:previous, after:afterObservation.value,
          observations:{start:startObservation,before:beforeObservation,after:afterObservation},
          change:rankChange(previous, afterObservation.value, matches[engine], isNew)};
      }
      return row;
    });
    const stats = {};
    for (const engine of ENGINES) {
      const comparableRows = rows.filter(r => !r.isNew && r[engine].before !== undefined && r[engine].after !== undefined);
      const currentRows = rows.filter(r => r[engine].after !== undefined);
      const comparable = matches[engine] && comparableRows.length > 0;
      const population = comparable ? comparableRows : currentRows;
      const count = (side, top) => population.filter(r => typeof r[engine][side] === 'number' && r[engine][side] <= top).length;
      stats[engine] = {comparable, total:population.length, currentTotal:currentRows.length,
        newCount:rows.filter(r => r.isNew && r[engine].after !== undefined).length,
        missingCount:after.rows.length - currentRows.length,
        errorCount:rows.filter(r => r[engine].observations.after.status === 'error').length,
        top3:{before:comparable ? count('before',3) : null, after:count('after',3)},
        top10:{before:comparable ? count('before',10) : null, after:count('after',10)}};
    }
    return {start, before, after, rows, stats, metaMatch:ENGINES.every(e => matches[e])};
  }
  function filterRows(rows, {search = '', direction = '', trend = 'all', cohort = 'all'} = {}, cohorts = []) {
    const term = normalize(search).replaceAll('ё', 'е');
    const preset = cohorts.find(item => item.id === cohort), cohortIds = preset && new Set(preset.keywordIds);
    return rows.filter(row => {
      if (cohortIds && !cohortIds.has(row.id)) return false;
      if (term && !normalize(row.query).replaceAll('ё','е').includes(term)) return false;
      if (direction && row.direction !== direction) return false;
      const kinds = ENGINES.map(e => row[e]?.change?.kind || 'no_data');
      if (trend === 'up') return kinds.some(k => ['up','appeared'].includes(k));
      if (trend === 'down') return kinds.some(k => ['down','lost'].includes(k));
      if (trend === 'same') return kinds.includes('same') && kinds.every(k => ['same','no_data'].includes(k));
      if (trend === 'new') return row.isNew;
      return true;
    });
  }
  function validateData(data) {
    const errors = [], check = (test, message) => { if (!test) errors.push(message); };
    if (!data?.project || !Array.isArray(data.reports)) return ['Нет настроек проекта или месяцев.'];
    check(data.project.id === 'molekula' && data.project.website === 'https://molekula.center/', 'Неверный проект отчёта.');
    check(months(data).includes(data.project.currentMonth), 'Текущий месяц отсутствует.');
    check(new Set(months(data)).size === data.reports.length, 'Повторный месяц.');
    for (const report of data.reports) {
      const label = report.month;
      check(report.projectId === data.project.id && /^\d{4}-(0[1-9]|1[0-2])$/.test(label), 'Неверный идентификатор месяца.');
      check(['in_progress','closed'].includes(report.status), `${label}: неизвестное состояние отчёта.`);
      for (const key of ['intro','conclusions']) check(Array.isArray(report[key]) && report[key].every(x => typeof x === 'string'), `${label}: неверный текст ${key}.`);
      check(!(report.archive && report.rankings), `${label}: архив смешан с API.`);
      if (report.archive) {
        const a = report.archive;
        check(a.sourceLabel === 'Google Таблица' && report.status === 'closed', `${label}: неверный источник архива.`);
        check(Array.isArray(a.rows) && a.rows.length > 0, `${label}: пустой архив позиций.`);
        check(new Set((a.rows || []).map(r => r.id)).size === a.rows?.length, `${label}: повторные запросы архива.`);
        for (const engine of ENGINES) {
          check(Array.isArray(a.dates?.[engine]) && a.dates[engine].every(d => validDate(d.date) && typeof d.label === 'string'), `${label}: неверные даты архива.`);
          for (const row of a.rows || []) {
            check(typeof row.query === 'string' && row.query.trim() && typeof row.id === 'string', `${label}: неверный запрос.`);
            check(Array.isArray(row[engine]) && row[engine].length === a.dates?.[engine]?.length && row[engine].every(v => v === null || typeof v === 'string'), `${label}: потеря столбцов архива.`);
          }
          for (const top of ['top10','top3']) check(['before','after','change'].every(k => typeof a.kpis?.[engine]?.[top]?.[k] === 'string'), `${label}: неполная сводка архива.`);
        }
      }
      if (report.rankings) {
        check(!!report.rankings.after, `${label}: нет текущего среза.`);
        check(report.rankings.after?.date?.slice(0,7) === label, `${label}: срез относится к другому месяцу.`);
        for (const cohort of report.rankings.cohorts || []) {
          check(typeof cohort.id === 'string' && typeof cohort.label === 'string' && Array.isArray(cohort.keywordIds) && cohort.keywordIds.every(id => typeof id === 'string'), `${label}: неверная выборка запросов.`);
          check(!own(cohort,'pageUrls') || (Array.isArray(cohort.pageUrls) && cohort.pageUrls.every(url => typeof url === 'string' && (!!safeHref(url) || /^\/(?!\/)[^\s?#]*$/.test(url) && !url.split('/').includes('..')))), `${label}: неверные страницы выборки.`);
        }
        for (const download of report.rankings.downloads || []) check(typeof download.label === 'string' && !!safeHref(download.url), `${label}: небезопасная выгрузка позиций.`);
        for (const snapshot of [report.rankings.start, report.rankings.before, report.rankings.after,...(report.rankings.history || [])].filter(Boolean)) {
          check(validDate(snapshot.date) && snapshot.region && snapshot.device && snapshot.sourceKey, `${label}: неполные настройки замера.`);
          check(Array.isArray(snapshot.rows) && new Set(snapshot.rows.map(r => r.id)).size === snapshot.rows.length, `${label}: неполные или повторные запросы.`);
          for (const row of snapshot.rows || []) {
            check(typeof row.id === 'string' && typeof row.query === 'string' && row.query.trim(), `${label}: запрос без ID или текста.`);
            for (const engine of ENGINES) if (own(row, engine)) check(row[engine] === null || (Number.isInteger(row[engine]) && row[engine] > 0 && row[engine] <= 1000), `${label}: неверная позиция.`);
            for (const engine of ENGINES) if (row.observations?.[engine]) {
              const item = row.observations[engine];
              check(['found','not_found','error','missing'].includes(item.status), `${label}: неверный статус замера.`);
              check(item.status !== 'found' || (Number.isInteger(row[engine]) && row[engine] > 0), `${label}: найденная позиция отсутствует.`);
              check(item.status !== 'not_found' || row[engine] === null, `${label}: отсутствие сайта не подтверждено.`);
              check(!own(item,'depth') || (Number.isInteger(item.depth) && item.depth > 0), `${label}: неверная глубина замера.`);
              check(!item.url || !!safeHref(item.url), `${label}: небезопасный URL замера.`);
            }
          }
        }
        if (report.rankings.before) check(report.rankings.before.date < report.rankings.after.date, `${label}: неверный порядок дат.`);
        if (report.rankings.start) check(report.rankings.start.date <= (report.rankings.before?.date || report.rankings.after.date), `${label}: первый замер позже отчётного периода.`);
      }
      if (report.traffic) {
        const traffic = report.traffic;
        check(Number.isInteger(traffic.visits) && traffic.visits >= 0, `${label}: неверное число визитов.`);
        if (own(traffic,'previousVisits')) check(Number.isInteger(traffic.previousVisits) && traffic.previousVisits >= 0, `${label}: неверное сравнение трафика.`);
        for (const period of [traffic.period,traffic.comparisonPeriod].filter(Boolean)) check(validDate(period.from) && validDate(period.to) && period.from <= period.to, `${label}: неверный период трафика.`);
        for (const engine of Object.values(traffic.engines || {})) check(['current','previous'].every(key => Number.isInteger(engine[key]) && engine[key] >= 0), `${label}: неверный трафик поисковика.`);
        for (const week of traffic.weekly || []) check(validDate(week.from) && validDate(week.to) && week.from <= week.to && ['visits','google','yandex','other'].every(key => Number.isInteger(week[key]) && week[key] >= 0), `${label}: неверная неделя трафика.`);
      }
      check(Array.isArray(report.works), `${label}: отсутствует список работ.`);
      check(new Set((report.works || []).map(w => w.id)).size === report.works?.length, `${label}: повторные работы.`);
      for (const work of report.works || []) {
        check(['id','title','summary','result'].every(k => typeof work[k] === 'string' && work[k].trim()), `${label}: неполная работа.`);
        check(work.why === null || typeof work.why === 'string', `${label}: неверное пояснение работы.`);
        for (const section of work.sections || []) {
          const validSection = !!section && typeof section === 'object' && !Array.isArray(section);
          check(validSection, `${label}: неверный раздел работы.`);
          if (!validSection) continue;
          if (own(section,'title')) check(typeof section.title === 'string', `${label}: неверный заголовок раздела.`);
          if (own(section,'afterText')) check(typeof section.afterText === 'string', `${label}: неверный текст после таблицы.`);
          if (own(section,'table')) {
            const table = section.table;
            const validColumns = Array.isArray(table?.columns) && table.columns.length > 0 && table.columns.every(column => typeof column === 'string' && column.trim());
            const validRows = Array.isArray(table?.rows) && table.rows.every(row => Array.isArray(row) && row.length === table.columns?.length && row.every(cell => typeof cell === 'string' || (typeof cell === 'number' && Number.isFinite(cell))));
            check(!!table && typeof table === 'object' && !Array.isArray(table) && validColumns && validRows, `${label}: неверная таблица раздела.`);
            if (table && own(table,'label')) check(typeof table.label === 'string', `${label}: неверная подпись таблицы.`);
          }
          for (const link of section.links || []) check(!!safeHref(link.url), `${label}: небезопасная ссылка.`);
        }
        for (const evidence of work.evidence || []) {
          check(['link','comparison','table'].includes(evidence.type), `${label}: неизвестное подтверждение.`);
          if (evidence.type === 'link') check(!!safeHref(evidence.url), `${label}: небезопасное подтверждение.`);
          if (evidence.type === 'comparison' && (own(evidence,'beforeImage') || own(evidence,'afterImage'))) {
            check(!!safeImageHref(evidence.beforeImage) && !!safeImageHref(evidence.afterImage), `${label}: сравнение должно содержать два изображения внутри evidence.`);
            check(['beforeAlt','afterAlt'].every(key => typeof evidence[key] === 'string' && evidence[key].trim()), `${label}: у снимков отсутствует описание.`);
          }
        }
      }
    }
    return errors;
  }
  return {ENGINES, months, monthLabel, getReport, defaultMonth, safeHref, safeImageHref, validDate, normalize, rankChange, settingsContext, sameSettings, observation, rankingsView, filterRows, validateData};
});
