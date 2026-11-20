// Token Radar's dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and renders
// the ranked board, the filters, a per-protocol detail view and the already-launched list. No network:
// every byte it shows is in data.js. Views are addressable by hash: #detail=<slug>, #category=<name>,
// #q=<text>, #watchlist=1, #tab=live.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var WATCH = {};
  (DATA.watchlist || []).forEach(function (s) { WATCH[s] = true; });
  var state = { q: '', category: 'all', chain: 'all', minTvl: 0, watchOnly: false, tab: 'board', sort: 'implied', detail: null };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtNum(n, digits) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return n.toFixed(digits === undefined ? 4 : digits);
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    var params = new URLSearchParams(hash);
    state.q = params.get('q') || '';
    state.category = params.get('category') || 'all';
    state.chain = params.get('chain') || 'all';
    state.minTvl = params.get('mintvl') ? Number(params.get('mintvl')) || 0 : 0;
    state.watchOnly = params.get('watchlist') === '1';
    state.tab = params.get('tab') === 'live' ? 'live' : 'board';
    state.sort = params.get('sort') || 'implied';
    state.detail = params.get('detail') || null;
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.minTvl) params.set('mintvl', String(state.minTvl));
    if (state.watchOnly) params.set('watchlist', '1');
    if (state.tab === 'live') params.set('tab', 'live');
    if (state.sort !== 'implied') params.set('sort', state.sort);
    if (state.detail) params.set('detail', state.detail);
    var next = params.toString();
    var url = next ? '#' + next : window.location.pathname + window.location.search;
    window.history.replaceState(null, '', url);
  }

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.watchOnly && !WATCH[r.slug]) return false;
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (state.minTvl && r.tvl_usd < state.minTvl) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (state.sort === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (state.sort === 'change') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (state.sort === 'age') { av = a.age_days; bv = b.age_days; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return 1;
      if (av > bv) return -1;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', null, 'Snapshot ', el('b', { text: DATA.as_of })),
        el('span', null, 'DefiLlama protocols snapshot'),
        el('span', { text: DATA.source })
      )
    );
  }

  function lede() {
    var early = DATA.board_size - DATA.watchlist_size;
    return el('section', { class: 'lede' },
      el('h1', null, 'Every pre-token protocol, ranked by ', el('span', { class: 'amber', text: 'implied value' })),
      el('p', { text: 'A token launch radar: what a protocol\u2019s token would be worth if its record stayed as it is, and what to do to farm it before it issues one. The watchlist is the floor, never the ceiling \u2014 the radar ranks all ' + DATA.board_size + ' rankable pre-token protocols, not just the ' + DATA.watchlist_size + ' on the watchlist.' }),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Board rows' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Early rows below the floor' }), el('b', { text: String(early) })),
        el('div', { class: 'fact' }, el('span', { text: 'Already launched, set aside' }), el('b', { text: String(DATA.live.length) }))
      )
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, slug or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var cat = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    cat.addEventListener('change', function () { state.category = cat.value; writeHash(); render(); });
    var chain = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chain.addEventListener('change', function () { state.chain = chain.value; writeHash(); render(); });
    var tvl = el('select', { id: 'mintvl', 'aria-label': 'Minimum TVL' },
      [['0', 'Any TVL'], ['100000000', 'TVL $100M+'], ['500000000', 'TVL $500M+'], ['1000000000', 'TVL $1B+']].map(function (o) {
        return el('option', { value: o[0], text: o[1], selected: Number(o[0]) === state.minTvl ? 'selected' : null });
      })
    );
    tvl.addEventListener('change', function () { state.minTvl = Number(tvl.value); writeHash(); render(); });
    var sort = el('select', { id: 'sort', 'aria-label': 'Sort the board' },
      [['implied', 'Implied value'], ['tvl', 'TVL'], ['change', '7d change'], ['age', 'Age']].map(function (o) {
        return el('option', { value: o[0], text: 'Sort: ' + o[1], selected: o[0] === state.sort ? 'selected' : null });
      })
    );
    sort.addEventListener('change', function () { state.sort = sort.value; writeHash(); render(); });
    var watch = el('input', { type: 'checkbox', id: 'watchonly', checked: state.watchOnly ? 'checked' : null });
    watch.addEventListener('change', function () { state.watchOnly = watch.checked; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'board' ? 'true' : 'false', text: 'Pre-token board', onclick: function () { state.tab = 'board'; state.detail = null; writeHash(); render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Already launched', onclick: function () { state.tab = 'live'; state.detail = null; writeHash(); render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), cat),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chain),
      el('div', { class: 'field' }, el('label', { for: 'mintvl', text: 'Min TVL' }), tvl),
      el('div', { class: 'field' }, el('label', { for: 'sort', text: 'Sort' }), sort),
      el('label', { class: 'check', for: 'watchonly' }, watch, 'Watchlist only'),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: state.tab === 'board' ? filteredRows().length + ' of ' + DATA.board_size + ' rows shown' : DATA.live.length + ' live-token protocols' })
    );
  }

  function rowCells(r, maxImplied) {
    var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
    var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
    var badge = WATCH[r.slug]
      ? el('span', { class: 'badge watch', text: 'WATCHLIST' })
      : el('span', { class: 'badge early', text: 'EARLY' });
    return [
      el('td', { class: 'num', text: String(r.rank) }),
      el('td', null, el('div', { class: 'name' },
        el('span', null, el('b', { text: r.name }), badge),
        el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 3).join(', ') : 'an unnamed chain') })
      )),
      el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
      el('td', { class: 'num ' + growthClass, text: growth }),
      el('td', { class: 'num', text: fmtAge(r.age_days) }),
      el('td', null, el('div', { class: 'implied' },
        el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / maxImplied) * 100)) + '%' })),
        el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
      ))
    ];
  }

  function boardTable() {
    var list = sortedRows(filteredRows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { class: 'sub', text: 'Clear the search or pick another category, chain or TVL floor to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.minTvl = 0; state.watchOnly = false; writeHash(); render(); } })
      ));
    }
    var max = DATA.rows[0] ? DATA.rows[0].implied_value_usd : 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var tr = el('tr', {
        'data-selected': state.detail === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      });
      rowCells(r, max).forEach(function (c) { tr.appendChild(c); });
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', class: 'num', text: 'Rank' }),
            el('th', { scope: 'col', text: 'Protocol' }),
            el('th', { scope: 'col', class: 'num', text: 'TVL' }),
            el('th', { scope: 'col', class: 'num', text: '7d' }),
            el('th', { scope: 'col', class: 'num', text: 'Age' }),
            el('th', { scope: 'col', class: 'num', text: 'Implied value' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', null, el('span', { class: 'status live', text: 'already trades' })),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 3).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num', text: r.mcap_usd > 0 && r.tvl_usd > 0 ? fmtNum(r.mcap_usd / r.tvl_usd, 2) + 'x' : 'n/a' })
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking \u2014 and their mcap/TVL is what calibrates it.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', class: 'num', text: 'TVL' }), el('th', { scope: 'col', class: 'num', text: '7d' }), el('th', { scope: 'col', class: 'num', text: 'Market cap' }), el('th', { scope: 'col', class: 'num', text: 'mcap / TVL' }))),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    var comps = (DATA.comps.rows || []).slice().sort(function (a, b) { return b.n - a.n || (a.category < b.category ? -1 : 1); });
    var tbody = el('tbody');
    comps.forEach(function (c) {
      tbody.appendChild(el('tr', null,
        el('td', { text: c.category || '(no category)' }),
        el('td', { text: String(c.n) }),
        el('td', { text: c.median === null ? '—' : fmtNum(c.median, 4) }),
        el('td', { text: fmtNum(c.ratio, 4) }),
        el('td', { text: c.fallback ? 'overall median (fallback)' : 'own median' })
      ));
    });
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How the value is worked out' }),
      el('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot\u2019s own figures. No protocol name is special-cased, no value is hardcoded, and no row is hand-picked.' }),
      el('div', { class: 'formula', text: DATA.formula }),
      el('p', { class: 'sub', text: 'Who can be ranked: a protocol that records no token, and is not a wrapped, staked or bridged product of a token that already trades. That means its category is not Bridge, Canonical Bridge, Liquid Staking, Liquid Restaking, Restaked BTC or CEX, its name carries no whole word wrapped, staked or staking, and it does not begin with an exchange\u2019s name (Binance, Coinbase, Bybit, Kraken, Bitget, OKX, Bitfinex, Gemini). A versioned pool (a name ending in V2 or the like) is out too. Wrapped products of a token that already trades are not launches still to come.' }),
      el('p', { class: 'sub', text: 'The comps ratio comes from the protocols whose token already trades: for each category, the median mcap/TVL of its live-token protocols, shrunk toward the overall median (' + fmtNum(DATA.comps.median_all, 4) + ') with a prior of ' + m.shrinkage_prior + ' \u2014 but only when the category has at least 3 live comps. With fewer than 3, a median of 1 or 2 is not a median, so the category falls back to the overall median instead; the table marks those rows as fallback. Categories with no live comps use the overall median too. Growth is the seven-day TVL change, clamped to ' + m.growth_floor + '…+' + m.growth_cap + '%. Maturity rewards how long a protocol has run with no token, up to ' + m.maturity_days + ' days; an unknown listing date counts as ' + m.unknown_age_days + ' days. Breadth adds 2% per extra chain, up to ' + m.breadth_max_chains + '.' }),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'comps' },
          el('caption', { class: 'sub', text: 'Live-token comps by category: n protocols, their median mcap/TVL, the ratio the model uses, and whether the category fell back to the overall median.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Category' }), el('th', { scope: 'col', text: 'n' }), el('th', { scope: 'col', text: 'Median mcap / TVL' }), el('th', { scope: 'col', text: 'Ratio used' }), el('th', { scope: 'col', text: 'Comps' }))),
          tbody
        )
      )
    );
  }

  function openDetail(slug) {
    state.detail = slug;
    state.tab = 'board';
    writeHash();
    render();
  }
  function closeDetail() {
    state.detail = null;
    writeHash();
    render();
  }

  function detailView() {
    var row = null;
    DATA.rows.forEach(function (r) { if (r.slug === state.detail) row = r; });
    if (!row) return el('div', { class: 'panel' }, el('div', { class: 'empty' },
      el('h2', { text: 'No such protocol on the board' }),
      el('p', { class: 'sub', text: 'The detail link names a slug this board does not rank.' }),
      el('button', { class: 'button primary', type: 'button', text: 'Back to board', onclick: closeDetail })
    ));
    var m = row.model;
    var math = fmtUsd(row.tvl_usd) + ' x ' + fmtNum(m.comp_ratio, 4) + ' x ' + fmtNum(m.growth_multiplier, 4) + ' x ' + fmtNum(m.maturity_multiplier, 4) + ' x ' + fmtNum(m.breadth_multiplier, 4) + ' = ' + fmtUsd(row.implied_value_usd);
    var steps = el('ol', { class: 'steps' });
    row.farm_steps.forEach(function (s) {
      var at = s.indexOf(' Cost: ');
      var action = at >= 0 ? s.slice(0, at) : s;
      var tail = at >= 0 ? s.slice(at + 1) : '';
      steps.appendChild(el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail })));
    });
    return el('section', { class: 'panel detail' },
      el('div', { class: 'detail-head' },
        el('div', null,
          el('span', { class: 'rankline', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + (WATCH[row.slug] ? ' \u00b7 Watchlist' : ' \u00b7 Early') }),
          el('h2', { text: row.name }),
          el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') + ' \u00b7 listed ' + (row.listed_at || 'unknown') })
        ),
        el('button', { class: 'button', type: 'button', text: 'Back to board', onclick: closeDetail })
      ),
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Comps ratio (' + (row.category || 'overall') + ')' }), el('b', { text: fmtNum(m.comp_ratio, 4) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { text: fmtNum(m.growth_multiplier, 4) })),
        el('div', null, el('span', { text: 'Maturity multiplier' }), el('b', { text: fmtNum(m.maturity_multiplier, 4) })),
        el('div', null, el('span', { text: 'Breadth multiplier' }), el('b', { text: fmtNum(m.breadth_multiplier, 4) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { text: fmtAge(row.age_days) })),
        el('div', { class: 'total' }, el('span', { text: 'Implied value' }), el('b', { text: fmtUsd(row.implied_value_usd) }))
      ),
      el('div', { class: 'math', text: math }),
      el('p', { class: 'caveat', text: row.name + ' records no token in DefiLlama\u2019s snapshot \u2014 that is the record, not proof it has none. Implied value is this entry\u2019s own claim, never make.fun\u2019s.' }),
      el('h3', { text: 'Farm plan \u2014 seven steps' }),
      steps
    );
  }

  function footer() {
    return el('footer', { class: 'foot' },
      el('p', { text: 'Implied values are this entry\u2019s own claim, never make.fun\u2019s.' }),
      el('p', { text: 'Data: ' + DATA.source + '. Snapshot date ' + DATA.as_of + '. Model ' + DATA.model_version + ': comps-calibrated from the snapshot itself.' })
    );
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(controls());
    if (state.detail) shell.appendChild(detailView());
    else if (state.tab === 'live') shell.appendChild(liveTable());
    else shell.appendChild(boardTable());
    if (!state.detail && state.tab === 'board') shell.appendChild(modelPanel());
    shell.appendChild(footer());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
  }

  readHash();
  render();
  window.addEventListener('hashchange', function () { readHash(); render(); });
})();
