/*
 * terms.js (wasc) — drives the per-term stats page for the Washington State
 * Supreme Court (courts/wasc/terms/index.md, which lives in the main
 * argument-aloud repo). It's the lean counterpart to ussc's own assets/js/
 * terms.js: a term heading, four counts, a coloured Court Calendar and a
 * sortable Court Cases table, and nothing else (no audio / Minutes / journal /
 * advocate widgets).
 *
 * This file is served from the wasc data origin (wasc.argumentaloud.org, aka
 * localhost:4013), the same host its cases.json / dates.json come from. The
 * page HTML that loads it is still served from the MAIN origin (same as the
 * SPA shell) so the document's origin — and therefore the postMessage in
 * openCase() below — matches the parent SPA. window.WASC_BASE_URL is injected
 * by the main repo's _layouts/pane.html. The SPA opens the page in its
 * page-viewer iframe via updateEmptyStateForTerm() with ?term=YYYY (+ &date=).
 */
(function () {
  "use strict";

  var WASC_BASE = String(window.WASC_BASE_URL || "").replace(/\/+$/, "");
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
                'July', 'August', 'September', 'October', 'November', 'December'];
  var MONTHS_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  var $ = function (id) { return document.getElementById(id); };
  var pad2 = function (n) { return n < 10 ? '0' + n : '' + n; };

  // ── docket helpers (mirror scripts/schema.js + ussc terms.js; ',' is a
  //    literal char in a wasc number, ';' is the joint-case delimiter) ──────
  function splitDockets(s) {
    return String(s == null ? '' : s).split(';').map(function (t) { return t.trim(); }).filter(Boolean);
  }
  // " (No. 79001-9)" / " (Nos. a, b)" to append onto a title; 4+ dockets
  // collapse to "first, …, last" with `full` carrying the untruncated form
  // for a tooltip. null when the case has no number.
  function caseNumberAnnotation(number) {
    var ns = splitDockets(number);
    if (!ns.length) return null;
    var label = ns.length > 1 ? 'Nos.' : 'No.';
    var shown = ns.length >= 4 ? [ns[0], '…', ns[ns.length - 1]] : ns;
    return {
      text: ' (' + label + ' ' + shown.join(', ') + ')',
      full: ns.length >= 4 ? ' (' + label + ' ' + ns.join(', ') + ')' : null,
    };
  }
  // Preferred `case=` value: the leading docket number when it's unique among
  // this term's cases, else the case id (matches ussc's caseUrlId /
  // explorer.js's _caseUrlId).
  function caseUrlId(c, siblings) {
    var num = splitDockets(c.number)[0] || '';
    if (num && siblings) {
      var n = 0;
      for (var i = 0; i < siblings.length; i++) {
        if ((splitDockets(siblings[i].number)[0] || '') === num) n++;
      }
      if (n === 1) return num;
    }
    return c.id || num;
  }

  var params = new URLSearchParams(location.search);
  var term = params.get('term') || '';
  var selectedDate = params.get('date') || '';

  if (!/^\d{4}$/.test(term)) {
    $('term-load-msg').textContent = 'Select a term.';
    return;
  }
  document.title = term + ' Term — WA Supreme Court';

  // Same-origin postMessage-to-parent-when-framed / direct-navigate-when-
  // standalone (mirrors ussc terms.js's wireSearchLink / openCase).
  function navTo(search) {
    if (window.parent !== window) {
      window.parent.postMessage({ type: 'ussc-navigate', search: search }, location.origin);
    } else {
      location.href = '/courts/wasc/' + search;
    }
  }

  // The term heading is a link back to this same term's full (date-less)
  // view — the only way back out of a single selected date, matching ussc.
  (function () {
    var el = $('stat-term-title');
    var link = document.createElement('a');
    link.className = 'stat-term-title-link';
    link.textContent = term + ' Term';
    link.href = '/courts/wasc/?term=' + encodeURIComponent(term);
    link.addEventListener('click', function (e) { e.preventDefault(); navTo('?term=' + encodeURIComponent(term)); });
    el.textContent = '';
    el.appendChild(link);
  })();

  var DAYS_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  function fmtDay(iso) {
    if (!iso) return '';
    var p = iso.split('-');
    if (p.length < 3) return iso;
    return MONTHS_ABBR[+p[1] - 1] + ' ' + (+p[2]) + ', ' + p[0];
  }
  // "2019-06-11" -> "Tuesday, June 11, 2019" (matches ussc's fmtDate)
  function fmtFullDate(iso) {
    var p = (iso || '').split('-');
    if (p.length < 3) return iso || '';
    var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
    if (isNaN(d)) return iso;
    return DAYS_FULL[d.getUTCDay()] + ', ' + MONTHS[+p[1] - 1] + ' ' + d.getUTCDate() + ', ' + p[0];
  }
  function updateDateHeading() {
    var el = $('stat-date-title');
    if (!el) return;
    if (selectedDate) { el.textContent = fmtFullDate(selectedDate); el.hidden = false; }
    else { el.hidden = true; el.textContent = ''; }
  }
  function fetchJson(url) {
    return fetch(url, { cache: 'no-cache' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }

  Promise.all([
    fetchJson(WASC_BASE + '/courts/wasc/terms/' + term + '/cases.json'),
    fetchJson(WASC_BASE + '/courts/wasc/terms/' + term + '/dates.json'),
  ]).then(function (res) {
    render(res[0] || [], res[1] || {});
  });

  // Prev / next term links, opposite the Court Calendar heading (mirrors
  // ussc's #stats-term-nav). The wasc term list is terms.json's decade
  // groups; each term id is just its year.
  fetchJson(WASC_BASE + '/courts/wasc/terms/terms.json').then(function (data) {
    if (!Array.isArray(data)) return;
    var ids = [];
    data.forEach(function (dec) {
      (dec.groups || []).forEach(function (g) { if (g && g.id) ids.push(String(g.id)); });
    });
    ids.sort();
    var i = ids.indexOf(term);
    if (i < 0) return;
    var prev = i > 0 ? ids[i - 1] : null;
    var next = i < ids.length - 1 ? ids[i + 1] : null;
    if (!prev && !next) return;
    $('stats-term-nav').hidden = false;
    if (prev) {
      var pb = $('stat-prev-term');
      pb.textContent = '« ' + prev;
      pb.hidden = false;
      pb.addEventListener('click', function () { navTo('?term=' + encodeURIComponent(prev)); });
    }
    if (next) {
      var nb = $('stat-next-term');
      nb.textContent = next + ' »';
      nb.hidden = false;
      nb.addEventListener('click', function () { navTo('?term=' + encodeURIComponent(next)); });
    }
  });

  function render(cases, datesData) {
    $('term-load-msg').hidden = true;
    if (!cases.length && !Object.keys(datesData).length) {
      $('term-load-msg').hidden = false;
      $('term-load-msg').textContent = 'No cases recorded for the ' + term + ' term.';
      return;
    }

    // Rows: this term's own cases, plus cross-year argument entries from this
    // term's dates.json — cases argued this year but filed under a later year
    // (link out to where they actually live).
    var rows = cases.map(function (c) {
      return {
        title: c.title || '(untitled)',
        number: c.number || '',
        argued: c.argument || '',
        decided: c.decision || '',
        vote: c.score || '',
        opinion: c.decision_gov || '',
        navTerm: term,
        navCase: caseUrlId(c, cases),
        xterm: false,
      };
    });
    Object.keys(datesData).forEach(function (iso) {
      (datesData[iso] || []).forEach(function (e) {
        if (e && (e.type === 'argument' || e.type === 'reargument') && e.id) {
          rows.push({
            title: e.title || '(untitled)',
            number: e.number || '',
            argued: iso, decided: '', vote: '', opinion: '',
            navTerm: e.term || '', navCase: e.id, xterm: true,
          });
        }
      });
    });

    var argDays = {}, decDays = {};
    var argued = 0, decided = 0, opinions = 0;
    cases.forEach(function (c) {
      if (c.argument) { argued++; argDays[c.argument] = 1; }
      if (c.decision) { decided++; decDays[c.decision] = 1; }
      if (c.decision_gov) opinions++;
    });
    rows.forEach(function (r) { if (r.xterm && r.argued) argDays[r.argued] = 1; });

    $('stat-argued-cases').textContent = argued;
    $('stat-argument-days').textContent = Object.keys(argDays).length;
    $('stat-decided').textContent = decided;
    $('stat-opinions-online').textContent = opinions;
    // The term-wide stat cards don't apply to a single selected date — the
    // Court Cases table already shows what's relevant for it (matches ussc).
    $('stats-grid').hidden = !!selectedDate;

    _argDays = argDays;
    _decDays = decDays;
    updateDateHeading();
    renderCalendar();
    buildTable(rows);   // ends by calling drawRows(), which honours selectedDate
  }

  // day maps kept module-scope so renderCalendar() can re-run when the
  // selected date changes (it re-windows the grid to the quarter around it).
  var _argDays = {}, _decDays = {};

  // ── calendar: a wasc term is a calendar year. With no date selected it's
  //    the full January–December of the term year; with a ?date= selected it's
  //    a 3-month window with that date's month in the middle (clamped to stay
  //    inside the term year), matching ussc's per-term Court Calendar.
  function renderCalendar() {
    var argDays = _argDays, decDays = _decDays;
    var isos = Object.keys(argDays).concat(Object.keys(decDays))
      .filter(function (s) { return /^\d{4}-\d\d-\d\d$/.test(s); });
    if (!isos.length) return;
    var y0 = +term, m0 = 0, monthCount = 12;
    if (/^\d{4}-\d\d-\d\d$/.test(selectedDate) && selectedDate.slice(0, 4) === term) {
      var selMo = +selectedDate.slice(5, 7) - 1;       // 0-based month of the selected date
      m0 = Math.max(0, Math.min(selMo - 1, 9));         // start a month early, but keep 3 months inside Jan–Dec
      monthCount = 3;
    }

    var calEl = document.createElement('div');
    calEl.className = 'term-calendar';
    for (var mi = 0; mi < monthCount; mi++) {
      var mo = (m0 + mi) % 12;
      var yr = y0 + Math.floor((m0 + mi) / 12);
      var mEl = document.createElement('div');
      mEl.className = 'cal-month';
      var hdr = document.createElement('div');
      hdr.className = 'cal-month-hdr';
      hdr.textContent = MONTHS[mo].toUpperCase() + ' ' + yr;
      mEl.appendChild(hdr);
      var dowRow = document.createElement('div');
      dowRow.className = 'cal-dow';
      DOW.forEach(function (n) { var s = document.createElement('span'); s.textContent = n; dowRow.appendChild(s); });
      mEl.appendChild(dowRow);
      var grid = document.createElement('div');
      grid.className = 'cal-days';
      var firstDow = new Date(Date.UTC(yr, mo, 1)).getUTCDay();
      var daysInMo = new Date(Date.UTC(yr, mo + 1, 0)).getUTCDate();
      for (var i = 0; i < firstDow; i++) {
        var em = document.createElement('span'); em.className = 'cal-day'; grid.appendChild(em);
      }
      for (var d = 1; d <= daysInMo; d++) {
        var iso = yr + '-' + pad2(mo + 1) + '-' + pad2(d);
        var isArg = !!argDays[iso], isDec = !!decDays[iso];
        var dayEl = document.createElement('span');
        var cls = 'cal-day';
        if (isArg && isDec) cls += ' cal-arg-dec';
        else if (isArg) cls += ' cal-arg';
        else if (isDec) cls += ' cal-dec';
        if (iso === selectedDate) cls += ' cal-sel';
        if (isArg || isDec) cls += ' cal-clickable';
        dayEl.className = cls;
        dayEl.textContent = d;
        if (isArg || isDec) {
          dayEl.dataset.iso = iso;
          dayEl.addEventListener('click', function () { selectDate(this.dataset.iso); });
        }
        grid.appendChild(dayEl);
      }
      mEl.appendChild(grid);
      calEl.appendChild(mEl);
    }
    $('term-calendar').innerHTML = '';
    $('term-calendar').appendChild(calEl);
    $('term-calendar').hidden = false;
    $('term-calendar-heading').hidden = false;
    $('term-calendar-legend').hidden = false;
  }

  // Select a date within this same term in place — no iframe reload, just a
  // redraw of what depends on it (heading, 3-month calendar, filtered table),
  // plus a top-level history entry so Back/Forward and bookmarking work.
  // There's no "click again to clear" — the term heading link is the way
  // back to the full view. Mirrors ussc terms.js's selectDate/syncUrlDate.
  function selectDate(iso) {
    if (iso === selectedDate) return;
    selectedDate = iso;
    $('stats-grid').hidden = true;
    updateDateHeading();
    renderCalendar();
    drawRows();
    syncUrlDate();
  }

  function syncUrlDate() {
    try {
      var own = new URL(location.href);
      own.searchParams.set('date', selectedDate);
      history.replaceState(null, '', own);
    } catch (e) { /* ignore */ }
    if (window.parent === window) return;
    try {
      var pu = new URL(window.parent.location.href);
      pu.searchParams.set('term', term);
      pu.searchParams.set('date', selectedDate);
      window.parent.history.pushState(null, '', pu);
    } catch (e) { /* cross-origin (shouldn't happen — page is same-origin as SPA) */ }
  }

  // ── table ────────────────────────────────────────────────────────────────
  var _allRows = [];
  var sortKey = 'title', sortAsc = true;

  function cmp(a, b, k) {
    var av = a[k] || '', bv = b[k] || '';
    if (k === 'title') { av = av.toLowerCase(); bv = bv.toLowerCase(); }
    if (k === 'vote') { av = av || '~'; bv = bv || '~'; }
    if (k === 'opinion') { av = av ? '0' : '1'; bv = bv ? '0' : '1'; }
    return av < bv ? -1 : av > bv ? 1 : 0;
  }
  function drawRows() {
    var tbody = $('case-listing-tbody');
    tbody.innerHTML = '';
    var list = _allRows.slice();
    if (selectedDate) {
      list = list.filter(function (r) { return r.argued === selectedDate || r.decided === selectedDate; });
    }
    list.sort(function (a, b) {
      var c = cmp(a, b, sortKey);
      if (!c && sortKey !== 'title') c = cmp(a, b, 'title');
      return sortAsc ? c : -c;
    });
    list.forEach(function (r) {
      var tr = document.createElement('tr');
      if (r.xterm) tr.className = 'xterm-row';

      var tdT = document.createElement('td');
      var anno = caseNumberAnnotation(r.number);
      var label = r.title + (anno ? anno.text : '');
      if (r.navCase && r.navTerm) {
        var a = document.createElement('a');
        // Real SPA URL so hover / copy-link / open-in-new-tab all show the
        // canonical destination (matches ussc); the click is still
        // intercepted for an in-app navigation.
        var search = '?term=' + encodeURIComponent(r.navTerm) + '&case=' + encodeURIComponent(r.navCase);
        a.href = '/courts/wasc/' + search;
        a.textContent = label;
        if (anno && anno.full) a.title = r.title + anno.full;
        a.addEventListener('click', function (ev) { ev.preventDefault(); openCase(r.navTerm, r.navCase); });
        tdT.appendChild(a);
      } else {
        tdT.textContent = label;
      }
      tr.appendChild(tdT);

      var tdA = document.createElement('td');
      tdA.className = 'col-date';
      tdA.textContent = fmtDay(r.argued);
      tr.appendChild(tdA);

      var tdD = document.createElement('td');
      tdD.className = 'col-date';
      tdD.textContent = fmtDay(r.decided);
      tr.appendChild(tdD);

      var tdV = document.createElement('td');
      tdV.className = 'col-vote';
      tdV.textContent = r.vote || '';
      tr.appendChild(tdV);

      var tdO = document.createElement('td');
      tdO.className = 'col-opinion';
      if (r.opinion) {
        var oa = document.createElement('a');
        oa.href = r.opinion;
        oa.target = '_blank';
        oa.rel = 'noopener noreferrer';
        oa.textContent = 'PDF';
        tdO.appendChild(oa);
      }
      tr.appendChild(tdO);

      tbody.appendChild(tr);
    });
    $('case-listing-table').hidden = false;
    $('case-listing-heading').hidden = false;
  }
  function buildTable(rows) {
    _allRows = rows;
    document.querySelectorAll('#case-listing-table th').forEach(function (th) {
      th.querySelector('button').addEventListener('click', function () {
        var k = th.dataset.sortKey;
        if (sortKey === k) sortAsc = !sortAsc;
        else { sortKey = k; sortAsc = (k === 'title'); }
        document.querySelectorAll('#case-listing-table th').forEach(function (o) { o.removeAttribute('aria-sort'); });
        th.setAttribute('aria-sort', sortAsc ? 'ascending' : 'descending');
        drawRows();
      });
    });
    drawRows();
  }

  function openCase(navTerm, navCase) {
    var search = '?term=' + encodeURIComponent(navTerm) + '&case=' + encodeURIComponent(navCase);
    if (window.parent !== window) {
      window.parent.postMessage({ type: 'ussc-navigate', search: search }, location.origin);
    } else {
      location.href = '/courts/wasc/' + search;
    }
  }
})();
