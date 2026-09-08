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

  var params = new URLSearchParams(location.search);
  var term = params.get('term') || '';
  var selectedDate = params.get('date') || '';

  if (!/^\d{4}$/.test(term)) {
    $('term-load-msg').textContent = 'Select a term.';
    return;
  }
  document.title = term + ' Term — WA Supreme Court';
  $('stat-term-title').textContent = term + ' Term';

  function fmtDay(iso) {
    if (!iso) return '';
    var p = iso.split('-');
    if (p.length < 3) return iso;
    return MONTHS_ABBR[+p[1] - 1] + ' ' + (+p[2]) + ', ' + p[0];
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
        argued: c.argument || '',
        decided: c.decision || '',
        vote: c.score || '',
        opinion: c.decision_gov || '',
        navTerm: term,
        navCase: c.id || (c.number ? String(c.number).split(';')[0].trim() : ''),
        xterm: false,
      };
    });
    Object.keys(datesData).forEach(function (iso) {
      (datesData[iso] || []).forEach(function (e) {
        if (e && (e.type === 'argument' || e.type === 'reargument') && e.id) {
          rows.push({
            title: e.title || '(untitled)',
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
    $('stats-grid').hidden = false;
    $('stats-note').hidden = false;

    renderCalendar(argDays, decDays);
    buildTable(rows);
  }

  // ── calendar: a wasc term is a calendar year — always January–December of
  //    the term year, nothing more. (A case decided this term but argued in an
  //    earlier year still counts in the stats and the table; its out-of-year
  //    argument day just isn't plotted here.)
  function renderCalendar(argDays, decDays) {
    var isos = Object.keys(argDays).concat(Object.keys(decDays))
      .filter(function (s) { return /^\d{4}-\d\d-\d\d$/.test(s); });
    if (!isos.length) return;
    var y0 = +term, m0 = 0, monthCount = 12;

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
          dayEl.addEventListener('click', function () { toggleDateFilter(this.dataset.iso); });
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

  function toggleDateFilter(iso) {
    selectedDate = (selectedDate === iso) ? '' : iso;
    document.querySelectorAll('.cal-day.cal-sel').forEach(function (el) { el.classList.remove('cal-sel'); });
    if (selectedDate) {
      document.querySelectorAll('.cal-day').forEach(function (el) {
        if (el.dataset.iso === selectedDate) el.classList.add('cal-sel');
      });
      $('stat-filter-note').hidden = false;
      $('stat-filter-note').textContent = 'Showing cases argued or decided on ' + fmtDay(selectedDate)
        + ' — click the day again to clear.';
    } else {
      $('stat-filter-note').hidden = true;
    }
    drawRows();
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
      if (r.navCase && r.navTerm) {
        var a = document.createElement('a');
        a.href = '#';
        a.textContent = r.title;
        a.addEventListener('click', function (ev) { ev.preventDefault(); openCase(r.navTerm, r.navCase); });
        tdT.appendChild(a);
      } else {
        tdT.textContent = r.title;
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
