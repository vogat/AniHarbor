(function () {
  'use strict';
  var STORE = 'aniharbor.v1';
  var main = document.getElementById('main');
  var video = document.getElementById('video');
  var playerElement = document.getElementById('player');
  var state = { view: 'home', providers: [], provider: 'auto', query: '', results: [], series: null, episodes: [], language: 'sub', online: false, requestId: 0, player: null, lastView: 'home', searches: [], show: null, seasonIndex: 0, providerIndex: 0, episodePage: 0, episodesPending: false, discover: {}, collection: { section: 'recommended', page: 1 }, trail: [], detailId: 0 };
  var settings = readStore('settings', { server: '', token: '' });
  if (/^#token=/.test(window.location.hash)) {
    try { settings.server = ''; settings.token = decodeURIComponent(window.location.hash.substring(7)); writeStore('settings', settings); window.history.replaceState(null, '', window.location.pathname + window.location.search); } catch (bootstrapError) {}
  }
  var saved = readStore('saved', {});
  var progress = readStore('progress', {});
  var hls = null;
  var playbackGeneration = 0;
  var controlsTimer = null;
  var toastTimer = null;
  var subtitleTimer = null;
  var startupTimer = null;
  var bufferingTimer = null;
  var lastSave = 0;
  var exitAt = 0;
  var av = window.webapis && window.webapis.avplay;

  function byId(id) { return document.getElementById(id); }
  function readStore(key, fallback) { try { return JSON.parse(localStorage.getItem(STORE + '.' + key)) || fallback; } catch (e) { return fallback; } }
  function writeStore(key, value) { try { localStorage.setItem(STORE + '.' + key, JSON.stringify(value)); } catch (e) { toast('Storage is full. Recent progress may not be saved.'); } }
  function escapeHtml(value) { return String(value === undefined || value === null ? '' : value).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function imageUrl(url) { return /^https?:\/\//i.test(url || '') ? url : 'assets/placeholder.svg'; }
  function setText(id, text) { byId(id).textContent = text; }
  function hasClass(element, name) { return (' ' + element.className + ' ').indexOf(' ' + name + ' ') > -1; }
  function toggleClass(element, name, on) { if (!element) { return; } var old = (' ' + element.className + ' ').replace(' ' + name + ' ', ' '); element.className = old.replace(/^\s+|\s+$/g, '') + (on ? ' ' + name : ''); }
  function hide(id, value) { toggleClass(byId(id), 'hidden', value); }
  function seriesKey(series) { return series.provider ? series.provider + ':' + series.id : series.id; }
  function titleIdentity(title) { return String(title || '').toLowerCase().replace(/\s*\((?:sub|dub)\)\s*$/i, '').replace(/[!"#$%&'()*+,\-.\/:;<=>?@\[\]\\^_`{|}~]+/g, ' ').replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, ''); }
  function showKey(show) { return show.id || 'title:' + titleIdentity(show.title) + ':' + (show.year || '') + ':' + (show.kind || 'unknown'); }
  function containsSelection(show, selection) { var seasons = show.seasons || [], i, j; if (!selection || !selection.provider) { return false; } if (show.provider && seriesKey(show) === seriesKey(selection)) { return true; } for (i = 0; i < seasons.length; i++) { for (j = 0; j < seasons[i].providers.length; j++) { if (seriesKey(seasons[i].providers[j]) === seriesKey(selection)) { return true; } } } return false; }
  function sameShow(left, right) {
    if (!left || !right) { return false; }
    var seasons, i, j;
    if (left.seasons && right.seasons) { if (showKey(left) === showKey(right)) { return true; } seasons = left.seasons; for (i = 0; i < seasons.length; i++) { for (j = 0; j < seasons[i].providers.length; j++) { if (containsSelection(right, seasons[i].providers[j])) { return true; } } } return false; }
    if ((left.provider && containsSelection(right, left)) || (right.provider && containsSelection(left, right))) { return true; }
    return !!(left.year && right.year && left.kind && right.kind && left.year === right.year && left.kind === right.kind && titleIdentity(left.title) === titleIdentity(right.title));
  }
  function currentSeason() { return state.show && state.show.seasons && state.show.seasons[state.seasonIndex]; }
  function progressKey(show, season) { return showKey(show) + ':season:' + season.id; }
  function selectedHistory() {
    var season = currentSeason(), history, key, item, i;
    if (!season || !state.show) { return null; }
    history = progress[progressKey(state.show, season)]; if (history) { return history; }
    for (key in progress) { if (Object.prototype.hasOwnProperty.call(progress, key)) { item = progress[key]; if (!item.series) { continue; } for (i = 0; i < season.providers.length; i++) { if (seriesKey(item.series) === seriesKey(season.providers[i])) { if (!history || item.updated > history.updated) { history = item; } } } } }
    return history || null;
  }
  function resumeEpisode(history) { var i; if (!history || state.episodesPending) { return null; } for (i = 0; i < state.episodes.length; i++) { if (Number(state.episodes[i].number) === Number(history.episode.number) && (!state.episodes[i].languages || !state.episodes[i].languages.length || state.episodes[i].languages.indexOf(history.language || state.language) >= 0)) { return state.episodes[i]; } } return null; }
  function isSavedShow(show) { var key; if (saved[showKey(show)]) { return true; } for (key in saved) { if (Object.prototype.hasOwnProperty.call(saved, key) && sameShow(saved[key], show)) { return true; } } return false; }
  function rememberView() {
    var focus = document.activeElement, rails = document.querySelectorAll('.card-rail'), positions = {}, i;
    for (i = 0; i < rails.length; i++) { positions[rails[i].id] = rails[i].scrollLeft; }
    return { view: state.view, collection: { section: state.collection.section, page: state.collection.page }, focus: focus && (focus.getAttribute('data-focus') || focus.id), scroll: window.pageYOffset || 0, rails: positions };
  }
  function restoreView(snapshot) {
    if (!snapshot) { return; }
    if (snapshot.view === 'search') { renderSearch(false); } else if (snapshot.view === 'saved') { renderSaved(); } else if (snapshot.view === 'collection') { renderCollection(snapshot.collection.section, snapshot.collection.page, false); } else if (snapshot.view === 'sources') { renderSources(false); } else { renderHome(); }
    setTimeout(function () { var elements = document.querySelectorAll('[data-focus]'), target = byId(snapshot.focus), i, key; for (i = 0; i < elements.length; i++) { if (elements[i].getAttribute('data-focus') === snapshot.focus) { target = elements[i]; break; } } if (target) { target.focus(); } for (key in snapshot.rails) { if (byId(key)) { byId(key).scrollLeft = snapshot.rails[key]; } } window.scrollTo(0, snapshot.scroll); }, 45);
  }
  function providerName(id) { var i; for (i = 0; i < state.providers.length; i++) { if (state.providers[i].id === id) { return state.providers[i].name; } } return id === 'auto' ? 'All sources' : (id || 'Unknown source'); }
  function messageFrom(error) { if (!error) { return 'The request could not be completed.'; } return typeof error === 'string' ? error : (error.message || error.error || 'The request could not be completed.'); }
  function clock(seconds) { seconds = Math.max(0, Math.floor(seconds || 0)); var hours = Math.floor(seconds / 3600); var minutes = Math.floor((seconds % 3600) / 60); var secs = seconds % 60; return (hours ? hours + ':' + (minutes < 10 ? '0' : '') : '') + minutes + ':' + (secs < 10 ? '0' : '') + secs; }
  function toast(text) { clearTimeout(toastTimer); setText('toast', text); hide('toast', false); toastTimer = setTimeout(function () { hide('toast', true); }, 4600); }
  function queryString(values) { var parts = [], key; for (key in values) { if (Object.prototype.hasOwnProperty.call(values, key) && values[key] !== undefined && values[key] !== null) { parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(values[key])); } } return parts.join('&'); }
  function api(path, values, callback, timeout) {
    var xhr = new XMLHttpRequest();
    var done = false;
    var base = (settings.server || '').replace(/\/+$/, '');
    function finish(error, data) { if (done) { return; } done = true; callback(error, data); }
    try {
      xhr.open('GET', base + path + (values ? '?' + queryString(values) : ''), true);
      xhr.timeout = timeout || 35000;
      xhr.setRequestHeader('Accept', 'application/json');
      if (settings.token) { xhr.setRequestHeader('x-app-token', settings.token); }
      xhr.onload = function () {
        var data;
        try { data = JSON.parse(xhr.responseText); } catch (e) { finish('The server returned an unreadable response. Check the server address in Settings.'); return; }
        if (xhr.status < 200 || xhr.status >= 300) { finish(data.error || data.message || 'Server error (' + xhr.status + ').', data); return; }
        finish(null, data);
      };
      xhr.onerror = function () { finish('Cannot reach your server. Make sure it is running and this device is on the same network.'); };
      xhr.ontimeout = function () { finish('The server took too long to respond. Try another source or check the connection.'); };
      xhr.onabort = function () { finish('Request cancelled.'); };
      xhr.send();
    } catch (e) { finish('Could not connect. Open Settings and enter the server address.'); }
    return xhr;
  }
  function updateConnection(online) { state.online = online; byId('connection').className = 'connection ' + (online ? 'online' : 'offline'); byId('connection').innerHTML = '<i></i>' + (online ? 'Server connected' : 'Server offline'); }
  function refreshProviders(callback) {
    api('/api/providers', null, function (error, data) {
      updateConnection(!error);
      if (!error) { state.providers = data.providers || []; }
      if (callback) { callback(error, data); }
    });
  }
  function activeFamilies() { var seen = {}, count = 0, i, family; for (i = 0; i < state.providers.length; i++) { family = state.providers[i].family || state.providers[i].id; if (!seen[family]) { seen[family] = true; count++; } } return count; }
  function focusFirst(selector) { var request = state.requestId; setTimeout(function () { if (request !== state.requestId) { return; } var target = document.querySelector(selector || '#main button:not([disabled]), #main input'); if (target && !hasHiddenParent(target)) { target.focus(); } }, 20); }
  function setView(view) { state.view = view; state.requestId++; var navs = document.querySelectorAll('.nav-button, .settings-button'), i; for (i = 0; i < navs.length; i++) { toggleClass(navs[i], 'active', navs[i].id === 'nav-' + (view === 'collection' ? 'home' : view)); } window.scrollTo(0, 0); }
  function heading(title, description, extra) { return '<div class="page-heading"><div><p class="eyebrow">ANIHARBOR / ' + escapeHtml(title) + '</p><h1>' + escapeHtml(title) + '</h1><p>' + escapeHtml(description) + '</p></div>' + (extra || '') + '</div>'; }
  function empty(title, text, action, label, error) { return '<div class="empty' + (error ? ' error' : '') + '"><div class="empty-icon">' + (error ? '!' : '&#9655;') + '</div><div><h3>' + escapeHtml(title) + '</h3><p>' + escapeHtml(text) + '</p></div>' + (action ? '<button class="button subtle" data-action="' + escapeHtml(action) + '">' + escapeHtml(label) + '</button>' : '') + '</div>'; }
  function loading(text) { return '<div class="loading" role="status"><span class="spinner"></span>' + escapeHtml(text) + '</div>'; }
  function listProgress() {
    var list = [], key, item, i, found;
    for (key in progress) { if (Object.prototype.hasOwnProperty.call(progress, key) && progress[key].series) { item = progress[key]; found = -1; for (i = 0; i < list.length; i++) { if (sameShow(list[i].show || list[i].series, item.show || item.series)) { found = i; break; } } if (found < 0) { list.push(item); } else if (list[found].updated < item.updated) { list[found] = item; } } }
    list.sort(function (a, b) { return b.updated - a.updated; }); return list;
  }
  function cardSummary(show) { var seasons = show.seasons || [], sources = {}, i, j, count = 0; for (i = 0; i < seasons.length; i++) { for (j = 0; j < seasons[i].providers.length; j++) { sources[seasons[i].providers[j].provider] = true; } } for (i in sources) { if (Object.prototype.hasOwnProperty.call(sources, i)) { count++; } } return show.kind === 'movie' ? 'Movie' : seasons.length > 1 ? seasons.length + ' seasons' : count ? count + (count === 1 ? ' provider' : ' providers') : 'Explore series'; }
  function cards(items, mode, rail) {
    var html = '<div class="cards' + (rail ? ' card-rail' : '') + '"' + (rail ? ' id="rail-' + mode + '" aria-label="' + (mode === 'new' ? 'Newly released' : mode === 'recommended' ? 'Recommended' : 'Continue watching') + '"' : '') + '>', i, item, series, itemProgress, percent;
    for (i = 0; i < items.length; i++) {
      item = items[i]; series = mode === 'continue' ? (item.show || item.series) : item; itemProgress = mode === 'continue' ? item : progress[seriesKey(series)];
      percent = itemProgress && itemProgress.duration ? Math.min(100, 100 * itemProgress.position / itemProgress.duration) : 0;
      html += '<button class="card" data-action="open-series" data-focus="card-' + mode + '-' + escapeHtml(showKey(series)) + '" data-list="' + mode + '" data-index="' + i + '"><span class="poster"><img src="' + escapeHtml(imageUrl(series.image)) + '" alt="" loading="lazy"><span class="card-tag">' + escapeHtml(mode === 'continue' ? 'EP ' + (item.episode.number || '?') + ' · ' + clock(item.position) : cardSummary(series)) + '</span>' + (mode === 'continue' ? '<span class="card-progress" style="width:' + percent + '%"></span>' : '') + '</span><span class="card-title">' + escapeHtml(series.title) + '</span><span class="card-subtitle">' + escapeHtml(mode === 'continue' ? (item.completed ? 'Episode completed · choose what is next' : 'Continue episode ' + item.episode.number) : [series.year || '', series.kind === 'movie' ? 'Movie' : 'Series'].join(' · ').replace(/^ · /, '')) + '</span></button>';
    }
    return html + '</div>';
  }
  function sectionTitle(section) { return section === 'new' ? 'Newly released' : 'Recommended'; }
  function discoverSection(section) { return '<section class="discover-section"><div class="section-heading"><h2>' + sectionTitle(section) + '</h2><span>' + (section === 'new' ? 'Latest episode additions' : 'Popular picks to explore') + '</span><button class="button subtle small" data-action="browse-section" data-section="' + section + '" data-focus="browse-' + section + '">View all &#8594;</button></div><div id="discover-' + section + '">' + loading('Finding your next show…') + '</div></section>'; }
  function feedDescription(data) { return data.description ? '<p class="catalog-note">' + (data.stale ? 'Showing cached results. ' : '') + escapeHtml(data.description) + '</p>' : ''; }
  function drawDiscover(section, data, error) { var container = byId('discover-' + section); if (!container) { return; } if (error) { container.innerHTML = empty('This row could not load', messageFrom(error), 'retry-' + section, 'Try again', true); return; } container.innerHTML = feedDescription(data) + (data.results.length ? cards(data.results, section, true) : empty('No titles available yet', 'Check back when the catalog has new recommendations.')); }
  function loadDiscover(section, force) {
    var key = section + ':1', cached = state.discover[key], request = state.requestId;
    if (cached && !force) { drawDiscover(section, cached); return; }
    api('/api/discover', { section: section, page: 1 }, function (error, data) { if (!error) { state.discover[key] = data; } if (state.view === 'home' && request === state.requestId) { drawDiscover(section, data, error); } }, 60000);
  }
  function renderHome() {
    setView('home');
    var history = listProgress().slice(0, 12);
    main.innerHTML = '<section class="hero"><div class="hero-content"><p class="eyebrow">A LITTLE ESCAPE. A WHOLE NEW WORLD.</p><h1>Your next world<br>is <span>waiting.</span></h1><p class="hero-copy">Find your favorites, settle into an episode, and pick up right where you left off.</p><button class="button primary" data-action="search" data-focus="find-anime">Find an anime &nbsp; &#8594;</button><button class="button subtle" data-action="saved" data-focus="home-list">My list</button><div class="hero-meta"><span><b>' + state.providers.length + '</b> CONFIGURED SOURCES</span><span><b>' + activeFamilies() + '</b> SOURCE FAMILIES</span><span>SUB + DUB</span></div></div><div class="hero-art" aria-hidden="true"><i class="orbit-one"></i><i class="orbit-two"></i></div></section>' + (history.length ? '<section><div class="section-heading"><h2>Continue watching</h2><button class="button subtle small" data-action="saved" data-focus="continue-list">View my list &#8594;</button></div>' + cards(history, 'continue', true) + '</section>' : '') + discoverSection('recommended') + discoverSection('new') + '<p class="catalog-note">Recommendations are popular catalog picks. Episode availability depends on your providers. Use left and right to browse each row, or View all for a full page.</p>' + (!state.online ? empty('Connect your home server', 'Start the server on your computer and enter its network address and pairing code in Settings.', 'settings', 'Open settings') : '');
    loadDiscover('recommended'); loadDiscover('new'); focusFirst('#main .primary');
  }
  function renderCollection(section, page, push) {
    if (push) { state.trail.push(rememberView()); }
    state.collection = { section: section, page: Math.max(1, page || 1) }; setView('collection');
    var request = state.requestId, key = section + ':' + state.collection.page;
    main.innerHTML = '<button class="back-button" data-action="back" data-focus="collection-back">&#8592; Back to Discover</button>' + heading(sectionTitle(section), section === 'new' ? 'Browse the latest episode additions to the catalog.' : 'Popular series from the catalog. Choose a show to explore its seasons and providers.') + '<div id="collection-content">' + loading('Loading ' + sectionTitle(section).toLowerCase() + '…') + '</div>';
    function draw(error, data) {
      if (state.view !== 'collection' || request !== state.requestId) { return; }
      if (error) { byId('collection-content').innerHTML = empty('This page could not load', messageFrom(error), 'retry-collection', 'Try again', true); focusFirst('#collection-content button'); return; }
      state.discover[key] = data;
      byId('collection-content').innerHTML = feedDescription(data) + (data.results.length ? cards(data.results, 'collection') : empty('No more titles here', 'Return to the previous page to keep exploring.')) + '<div class="pagination"><button class="button subtle" data-action="collection-prev" data-focus="collection-prev"' + (state.collection.page < 2 ? ' disabled' : '') + '>&#8592; Previous page</button><span>Page ' + state.collection.page + '</span><button class="button subtle" data-action="collection-next" data-focus="collection-next"' + (!data.hasNextPage ? ' disabled' : '') + '>Next page &#8594;</button></div>';
      focusFirst('#collection-content .card, #collection-content button:not([disabled])');
    }
    if (state.discover[key]) { draw(null, state.discover[key]); } else { api('/api/discover', { section: section, page: state.collection.page }, draw, 60000); }
  }
  function renderSearch(runSearch) {
    setView('search');
    main.innerHTML = heading('Find your next favorite', 'One card per show. Choose its season and provider after opening it.') + '<form id="search-form" class="search-form"><div class="input-wrap"><span class="search-symbol" aria-hidden="true">&#9906;</span><label class="sr-only" for="search-input">Anime title</label><input id="search-input" type="search" autocomplete="off" placeholder="Search an anime title…" value="' + escapeHtml(state.query) + '"></div>' + (state.provider !== 'auto' ? '<button type="button" class="button source-choice" data-action="all-providers">' + escapeHtml(providerName(state.provider)) + ' · Use all</button>' : '') + '<button type="submit" class="button primary">Search &#8594;</button></form><div id="search-results"></div>';
    byId('search-form').onsubmit = function (event) { event.preventDefault(); performSearch(); };
    if (runSearch && state.query) { performSearch(); } else if (state.query && state.results.length) { renderSearchResults(state.results, []); } else { byId('search-results').innerHTML = empty('A whole world to explore', 'Try a title in English or Japanese. Availability and episode languages vary between sources.'); }
    focusFirst('#search-input');
  }
  function performSearch() {
    var query = byId('search-input').value.replace(/^\s+|\s+$/g, '');
    if (!query) { toast('Enter an anime title to search.'); byId('search-input').focus(); return; }
    state.query = query; state.results = [];
    var request = ++state.requestId;
    byId('search-results').innerHTML = loading('Searching ' + providerName(state.provider).toLowerCase() + '…');
    api('/api/search', { q: query, provider: state.provider }, function (error, data) {
      if (state.view !== 'search' || request !== state.requestId) { return; }
      if (error) { byId('search-results').innerHTML = empty('Search could not finish', messageFrom(error), 'retry-search', 'Try again', true); return; }
      state.results = data.results || [];
      renderSearchResults(state.results, data.errors || []);
      if (state.results.length) { focusFirst('#search-results .card'); }
    }, 90000);
  }
  function renderSearchResults(results, errors) {
    var html = '', errorNames = [], i;
    for (i = 0; i < errors.length; i++) { errorNames.push(providerName(errors[i].provider || errors[i].id) + ': ' + messageFrom(errors[i])); }
    if (errors.length) { html += '<div class="note">Some sources could not respond. ' + escapeHtml(errorNames.join(' · ')) + '</div>'; }
    html += '<div class="section-heading"><h2>' + escapeHtml(state.query ? 'Results for “' + state.query + '”' : 'Search results') + '</h2><span>' + results.length + ' ' + (results.length === 1 ? 'match' : 'matches') + '</span></div>';
    html += results.length ? cards(results, 'results') : empty('No matching series yet', 'Try a shorter title, another spelling, or choose a different source.', 'focus-search', 'Edit search');
    byId('search-results').innerHTML = html;
  }
  function savedList() { var list = [], key, i, exists; for (key in saved) { if (Object.prototype.hasOwnProperty.call(saved, key)) { exists = false; for (i = 0; i < list.length; i++) { if (sameShow(list[i], saved[key])) { exists = true; break; } } if (!exists) { list.push(saved[key]); } } } return list; }
  function renderSaved() { setView('saved'); var items = savedList(), history = listProgress(); main.innerHTML = heading('Your evening, lined up', 'Favorite series and recently watched episodes, saved on this device.') + '<div class="section-heading"><h2>My list</h2><span>' + items.length + ' saved</span></div>' + (items.length ? cards(items, 'saved') : empty('Keep your favorites close', 'Open a series and choose “Add to my list” to keep it here.', 'search', 'Find a series')) + (history.length ? '<div class="section-heading"><h2>Recently watched</h2></div>' + cards(history, 'continue') : ''); focusFirst(); }
  function renderSources(refresh) {
    setView('sources');
    var request = state.requestId;
    main.innerHTML = heading('A few ways to keep watching', 'Independent source families matter more than mirror addresses.', '<button class="button subtle" data-action="refresh-sources">Refresh status</button>') + '<div id="source-content">' + loading('Checking configured sources…') + '</div>';
    function draw(error) {
      if (state.view !== 'sources' || state.requestId !== request) { return; }
      var html = '', i, source, status;
      if (error) { byId('source-content').innerHTML = empty('Your server is unavailable', messageFrom(error), 'settings', 'Connection settings', true); return; }
      if (!state.providers.length) { byId('source-content').innerHTML = empty('No sources configured', 'Add a provider to your server configuration, then refresh this page. The setup guide explains the supported provider types.', 'settings', 'Connection settings'); return; }
      html += '<p class="source-tip">' + state.providers.length + ' configured providers across ' + activeFamilies() + ' source families. Availability can change; a listed provider is not a guarantee that every episode will play.</p><div class="source-cards">';
      for (i = 0; i < state.providers.length; i++) {
        source = state.providers[i]; status = source.status || 'configured';
        html += '<section class="source-card' + (state.provider === source.id ? ' active-source' : '') + '"><div class="source-card-heading"><span class="source-letter">' + escapeHtml(source.name.substring(0, 1)) + '</span><h2>' + escapeHtml(source.name) + '</h2></div><span class="status-pill' + (/error|down|unavailable|disabled|cooldown/.test(status) ? ' unavailable' : '') + '">' + escapeHtml(status) + '</span><p>' + escapeHtml(source.error || source.note || 'Search this provider directly or include it when searching all sources.') + '</p><div class="source-family">Family: ' + escapeHtml(source.family || source.id) + ' · ' + escapeHtml((source.languages || ['sub']).join(' / ')) + '</div><button class="button subtle" data-action="select-provider" data-index="' + i + '">Search ' + escapeHtml(source.name) + ' &#8594;</button></section>';
      }
      byId('source-content').innerHTML = html + '</div><div class="note">Fallback tries another source when a stream fails. It cannot restore a series that is missing everywhere or guarantee that two providers use different video hosts.</div>';
    }
    if (refresh) { refreshProviders(draw); } else { draw(null); }
    focusFirst();
  }
  function renderSettings() {
    setView('settings');
    main.innerHTML = heading('Make it yours', 'Connect AniHarbor to the server running on your home network.') + '<div class="settings-layout"><form id="settings-form" class="settings-panel"><label for="server-url">Server address</label><input id="server-url" type="url" placeholder="http://192.168.1.50:8787" value="' + escapeHtml(settings.server) + '" autocomplete="off"><p>Use your computer’s local network address. Leave this blank when using AniHarbor in the server’s browser page.</p><label for="pairing-token">Pairing code <span class="source-family">(shown by your server)</span></label><input id="pairing-token" type="password" placeholder="Enter the server pairing code" value="' + escapeHtml(settings.token) + '" autocomplete="off"><p>The address and token stay on this device. Your watch history is stored here too.</p><button type="submit" class="button primary">Save &amp; connect</button><button type="button" class="button subtle" data-action="test-connection">Test connection</button><div id="connection-result" class="connection-result" role="status"></div></form><aside class="settings-aside"><p class="eyebrow">SETTLE IN</p><h3>A computer. Your TV. One network.</h3><p>Keep your server computer awake while watching. Start the server before opening AniHarbor on the TV.</p><p>On your Samsung, use the arrow keys to move, OK to select, and Return to go back. Your play and pause buttons work during episodes.</p><p>Source selection and subtitles can be changed during playback.</p><button class="button subtle small" data-action="sources">View sources &#8594;</button></aside></div>';
    byId('settings-form').onsubmit = function (event) { event.preventDefault(); saveSettings(true); };
    focusFirst('#server-url');
  }
  function saveSettings(connect) {
    var server = byId('server-url').value.replace(/^\s+|\s+$/g, '').replace(/\/+$/, '');
    if (server && !/^https?:\/\/[^\s/?#]+(?::\d+)?$/i.test(server)) { setText('connection-result', 'Enter a full server origin, such as http://192.168.1.50:8787, without a path.'); return; }
    settings = { server: server, token: byId('pairing-token').value.replace(/^\s+|\s+$/g, '') };
    byId('server-url').value = settings.server; byId('pairing-token').value = settings.token;
    writeStore('settings', settings);
    if (connect) { testConnection(); } else { toast('Settings saved.'); }
  }
  function testConnection() {
    if (state.view !== 'settings') { return; }
    var server = byId('server-url').value.replace(/^\s+|\s+$/g, '').replace(/\/+$/, '');
    if (server !== settings.server || byId('pairing-token').value !== settings.token) { saveSettings(true); return; }
    setText('connection-result', 'Connecting to your server…');
    api('/api/health', null, function (error) {
      updateConnection(!error);
      if (state.view !== 'settings') { return; }
      if (error) { setText('connection-result', messageFrom(error)); return; }
      refreshProviders(function (providerError) { if (state.view === 'settings') { setText('connection-result', providerError ? 'Server connected, but sources could not be loaded: ' + messageFrom(providerError) : 'Connected. ' + state.providers.length + ' providers across ' + activeFamilies() + ' source families are configured.'); } });
    }, 12000);
  }
  function wrapLegacy(series) { return { id: 'legacy:' + seriesKey(series), title: series.title, image: series.image, year: series.year, kind: 'series', seasons: [{ id: series.id, title: series.title, label: 'Episodes', providers: [series] }] }; }
  function openSeries(show, history) {
    if (!show) { return; }
    if (state.view !== 'detail') { state.lastView = state.view; state.trail.push(rememberView()); }
    state.show = show; state.series = null; state.seasonIndex = 0; state.providerIndex = 0; state.episodePage = 0; state.episodes = []; state.episodesPending = true; state.detailId++; setView('detail');
    var request = state.requestId, detailId = state.detailId;
    function ready(resolved) {
      if (state.view !== 'detail' || request !== state.requestId) { return; }
      state.show = resolved; var i, j, season, match = history && history.series;
      if (match) { for (i = 0; i < resolved.seasons.length; i++) { season = resolved.seasons[i]; for (j = 0; j < season.providers.length; j++) { if (seriesKey(season.providers[j]) === seriesKey(match)) { state.seasonIndex = i; state.providerIndex = j; } } } state.language = history.language || 'sub'; }
      selectDetailSource(true); focusFirst('#save-series');
    }
    if (show.seasons && show.seasons.length) {
      ready(show);
      if (show.malId && !show.expanded) {
        api('/api/show', { title: show.title, malId: show.malId }, function (error, data) {
          if (error || !data.show || !data.show.seasons || !data.show.seasons.length || state.view !== 'detail' || state.player || detailId !== state.detailId) { return; }
          var selected = seriesKey(state.series), i, j, nextSeason = -1, nextProvider = 0, focused = document.activeElement, actionName = focused && focused.getAttribute('data-action'), focusedIndex = focused && focused.getAttribute('data-index'), scroll = window.pageYOffset, target;
          for (i = 0; i < data.show.seasons.length; i++) { for (j = 0; j < data.show.seasons[i].providers.length; j++) { if (seriesKey(data.show.seasons[i].providers[j]) === selected) { nextSeason = i; nextProvider = j; } } }
          if (nextSeason < 0) { return; }
          state.show = data.show; state.seasonIndex = nextSeason; state.providerIndex = nextProvider; state.series = currentSeason().providers[nextProvider];
          drawDetail(state.episodesPending);
          if (actionName === 'select-season') { target = document.querySelector('[data-action="select-season"].selected'); } else if (actionName === 'detail-provider') { target = document.querySelector('[data-action="detail-provider"].selected'); } else if (actionName) { target = document.querySelector('[data-action="' + actionName + '"]' + (focusedIndex !== null ? '[data-index="' + focusedIndex + '"]' : '')); }
          if (target) { target.focus(); } window.scrollTo(0, scroll);
        }, 90000);
      }
      return;
    }
    main.innerHTML = '<section class="detail"><button class="back-button" data-action="back">&#8592; Back</button>' + heading(show.title, 'Finding seasons and providers…') + loading('Matching this show across your providers…') + '</section>'; focusFirst('#main .back-button');
    api('/api/show', { title: show.title, malId: show.malId || '', lookupTitles: JSON.stringify(show.lookupTitles || []) }, function (error, data) {
      if (state.view !== 'detail' || request !== state.requestId) { return; }
      if (error || !data.show || !data.show.seasons || !data.show.seasons.length) { if (show.provider) { ready(wrapLegacy(show)); return; } state.episodesPending = false; main.innerHTML = '<section class="detail"><button class="back-button" data-action="back">&#8592; Back</button>' + heading(show.title, 'No provider match available right now.') + empty('This title is not available from your sources', error ? messageFrom(error) : 'Try searching for another spelling or check again later.', 'search-show', 'Search this title', true) + '</section>'; focusFirst('#main .back-button'); return; }
      ready(data.show);
    }, 120000);
  }
  function selectDetailSource(initial) {
    var season = currentSeason(); if (!season || !season.providers.length) { return; }
    state.series = season.providers[state.providerIndex] || season.providers[0]; state.episodes = []; state.episodesPending = true; state.episodePage = 0;
    var request = ++state.requestId;
    drawDetail(true);
    api('/api/episodes', { provider: state.series.provider, id: state.series.id }, function (error, data) {
      if (state.view !== 'detail' || request !== state.requestId) { return; }
      state.episodesPending = false;
      if (error) { byId('episodes-content').innerHTML = empty('Episodes are unavailable', messageFrom(error), 'retry-episodes', 'Try again', true); return; }
      state.episodes = data.episodes || []; var history = selectedHistory(), match = resumeEpisode(history), i, count = 0;
      if (initial && match) { for (i = 0; i < state.episodes.length; i++) { if (state.episodes[i].languages && state.episodes[i].languages.length && state.episodes[i].languages.indexOf(state.language) < 0) { continue; } if (state.episodes[i] === match) { state.episodePage = Math.floor(count / 24); break; } count++; } }
      drawEpisodes(); updateResume();
    }, 90000);
  }
  function drawDetail(pending) {
    var show = state.show, season = currentSeason(), i, html = '', isSaved = isSavedShow(show);
    if (!season || !state.series) { return; }
    if (show.kind !== 'movie') { html += '<div class="detail-picker"><h2>Season</h2><div class="picker-options" aria-label="Seasons">'; for (i = 0; i < show.seasons.length; i++) { html += '<button class="button small' + (i === state.seasonIndex ? ' selected' : '') + '" data-action="select-season" data-index="' + i + '" aria-pressed="' + (i === state.seasonIndex) + '">' + escapeHtml(show.seasons[i].label || show.seasons[i].title || 'Season ' + (i + 1)) + '</button>'; } html += '</div></div>'; }
    html += '<div class="detail-picker"><h2>Provider</h2><div class="picker-options" aria-label="Providers">';
    for (i = 0; i < season.providers.length; i++) { html += '<button class="button small' + (i === state.providerIndex ? ' selected' : '') + '" data-action="detail-provider" data-index="' + i + '" aria-pressed="' + (i === state.providerIndex) + '">' + escapeHtml(providerName(season.providers[i].provider)) + '</button>'; }
    html += '</div></div>';
    main.innerHTML = '<section class="detail"><button class="back-button" data-action="back">&#8592; Back to ' + escapeHtml(state.lastView === 'search' ? 'results' : state.lastView === 'saved' ? 'my list' : 'discover') + '</button><div class="detail-header"><img class="detail-cover" src="' + escapeHtml(imageUrl(show.image || state.series.image)) + '" alt=""><div class="detail-info"><p class="eyebrow">' + escapeHtml(show.kind === 'movie' ? 'MOVIE' : 'SERIES') + (show.year ? ' / ' + escapeHtml(show.year) : '') + '</p><h1>' + escapeHtml(show.title) + '</h1><p class="detail-description">' + escapeHtml(show.description || (show.kind === 'movie' ? 'Choose a provider, then select the movie below. Your place is remembered on this device.' : 'Choose a season and provider, then select an episode. Your place is remembered on this device.')) + '</p><button id="save-series" class="button ' + (isSaved ? 'subtle' : 'primary') + '" data-action="save-series">' + (isSaved ? '&#10003; In my list' : '+ Add to my list') + '</button><button id="resume-series" class="button subtle hidden" data-action="resume"></button></div></div><div class="detail-selectors">' + html + '</div><div class="detail-tools"><h2>' + (show.kind === 'movie' ? 'Watch movie' : 'Episodes') + '</h2><div class="language-switch"><button class="button small' + (state.language === 'sub' ? ' selected' : '') + '" data-action="language" data-language="sub" aria-pressed="' + (state.language === 'sub') + '">SUB</button><button class="button small' + (state.language === 'dub' ? ' selected' : '') + '" data-action="language" data-language="dub" aria-pressed="' + (state.language === 'dub') + '">DUB</button></div></div><div id="episodes-content">' + (pending ? loading('Loading episodes from ' + providerName(state.series.provider) + '…') : '') + '</div></section>';
    if (!pending) { drawEpisodes(); updateResume(); }
  }
  function updateResume() { var history = selectedHistory(), episode = resumeEpisode(history), button = byId('resume-series'); if (!button) { return; } toggleClass(button, 'hidden', !episode || history.completed); if (episode && !history.completed) { button.textContent = 'Resume episode ' + history.episode.number + ' · ' + clock(history.position); } }
  function drawEpisodes() {
    var html = '<div class="episode-grid">', i, episode, eligible = [], history = selectedHistory(), isCurrent, start, end, pages;
    if (state.episodesPending) { byId('episodes-content').innerHTML = loading('Loading episodes…'); return; }
    for (i = 0; i < state.episodes.length; i++) { episode = state.episodes[i]; if (episode.languages && episode.languages.length && episode.languages.indexOf(state.language) < 0) { continue; } eligible.push(i); }
    pages = Math.ceil(eligible.length / 24); state.episodePage = Math.max(0, Math.min(state.episodePage, pages - 1)); start = state.episodePage * 24; end = Math.min(start + 24, eligible.length);
    for (i = start; i < end; i++) { episode = state.episodes[eligible[i]]; isCurrent = history && Number(history.episode.number) === Number(episode.number);
      html += '<button class="episode' + (isCurrent ? ' resume-episode' : '') + '" data-action="play-episode" data-index="' + eligible[i] + '" data-focus="episode-' + eligible[i] + '"><span class="episode-number">' + escapeHtml(episode.number || (eligible[i] + 1)) + '</span><span class="episode-text"><span class="episode-label">' + escapeHtml(episode.title || 'Episode ' + (episode.number || (eligible[i] + 1))) + '</span><span class="episode-detail">' + (isCurrent ? (history.completed ? 'Watched' : 'Resume · ' + clock(history.position)) : state.language.toUpperCase() + ' · Play episode') + '</span></span></button>';
    }
    html += '</div>';
    if (pages > 1) { html = '<div class="episode-jump"><label for="episode-jump">Jump to episode</label><input id="episode-jump" type="number" min="1" inputmode="numeric" placeholder="Number"><button class="button small" data-action="jump-episode">Go</button><span>' + (start + 1) + '–' + end + ' of ' + eligible.length + ' episodes</span></div>' + html + '<div class="pagination"><button class="button subtle" data-action="episode-prev"' + (state.episodePage === 0 ? ' disabled' : '') + '>&#8592; Previous episodes</button><span>Page ' + (state.episodePage + 1) + ' of ' + pages + '</span><button class="button subtle" data-action="episode-next"' + (state.episodePage >= pages - 1 ? ' disabled' : '') + '>Next episodes &#8594;</button></div>'; }
    byId('episodes-content').innerHTML = eligible.length ? html : empty('No ' + state.language + ' episodes listed', 'Try the other language or select another provider above.', 'focus-providers', 'Choose provider');
  }
  function jumpEpisode() { var number = Number(byId('episode-jump').value), i, count = 0; for (i = 0; i < state.episodes.length; i++) { if (state.episodes[i].languages && state.episodes[i].languages.length && state.episodes[i].languages.indexOf(state.language) < 0) { continue; } if (Number(state.episodes[i].number) === number) { state.episodePage = Math.floor(count / 24); drawEpisodes(); focusFirst('[data-action="play-episode"][data-index="' + i + '"]'); return; } count++; } toast('That episode is not listed in the selected language.'); }
  function toggleSaved() { var key = showKey(state.show), old, remove = isSavedShow(state.show); for (old in saved) { if (Object.prototype.hasOwnProperty.call(saved, old) && sameShow(saved[old], state.show)) { delete saved[old]; } } if (!remove) { saved[key] = state.show; } toast(remove ? 'Removed from your list.' : 'Added to your list.'); writeStore('saved', saved); drawDetail(state.episodesPending); focusFirst('#save-series'); }
  function goBack() {
    if (state.player) { closePlayer(); return; }
    if (state.trail.length && (state.view === 'detail' || state.view === 'collection')) { restoreView(state.trail.pop()); return; }
    if (state.view !== 'home') { state.trail = []; renderHome(); return; }
    if (window.tizen && window.tizen.application) { if (Date.now() - exitAt < 2400) { window.tizen.application.getCurrentApplication().exit(); } else { exitAt = Date.now(); toast('Press Return again to close AniHarbor.'); } }
  }

  function startEpisode(episode, resumeAt) {
    if (!episode) { return; }
    if (state.player) { saveProgress(); stopEngine(); }
    var history = selectedHistory();
    if (resumeAt === undefined) { resumeAt = history && !history.completed && Number(history.episode.number) === Number(episode.number) ? history.position : 0; }
    state.player = { series: state.series, show: state.show, seasonId: currentSeason().id, episode: episode, language: state.language, provider: state.series.provider, excluded: [], sources: [], sourceIndex: -1, position: resumeAt || 0, duration: 0, paused: false, started: false, subtitleIndex: -1, recovering: false, failures: 0, complete: false };
    lastSave = 0; playerElement.className = 'player controls-visible' + (av ? ' tv-playback' : '');
    toggleClass(document.body, 'tv-active', !!av); toggleClass(document.documentElement, 'tv-active', !!av);
    byId('app').setAttribute('aria-hidden', 'true');
    setText('player-title', state.show.title); setText('player-episode', 'Episode ' + episode.number + ' · ' + state.language.toUpperCase()); setText('player-provider', providerName(state.series.provider)); setText('player-status', ''); setText('player-time', clock(resumeAt) + ' / 0:00'); byId('progress-fill').style.width = '0%';
    setText('toggle-play', 'Pause'); setText('captions-button', 'Subtitles: off'); byId('next-episode').disabled = !findNextEpisode();
    showPlayerMessage('Finding an episode stream…'); focusFirst('#toggle-play'); resolveEpisode();
  }
  function showPlayerMessage(text, error) { hide('player-loading', false); toggleClass(byId('player-loading'), 'error', !!error); setText('player-message', text); }
  function screenSaver(enabled) { try { if (window.webapis && window.webapis.appcommon) { window.webapis.appcommon.setScreenSaver(enabled ? window.webapis.appcommon.AppCommonScreenSaverState.SCREEN_SAVER_ON : window.webapis.appcommon.AppCommonScreenSaverState.SCREEN_SAVER_OFF, function () {}, function () {}); } } catch (e) {} }
  function resolveEpisode() {
    var playback = state.player;
    if (!playback) { return; }
    var generation = ++playbackGeneration;
    playback.recovering = true;
    api('/api/resolve', { provider: playback.series.provider, id: playback.series.id, episodeId: playback.episode.id, title: playback.series.title, number: playback.episode.number, year: playback.series.year || '', language: playback.language, exclude: playback.excluded.join(',') }, function (error, data) {
      if (!state.player || generation !== playbackGeneration) { return; }
      playback.recovering = false;
      if (error || !data.sources || !data.sources.length) { playbackFailed(error ? messageFrom(error) : 'No playable stream was returned. Try another episode, language, or source.'); return; }
      playback.provider = data.provider || playback.series.provider; playback.sources = data.sources; playback.sourceIndex = -1;
      setText('player-provider', providerName(playback.provider));
      setText('player-status', playback.excluded.length ? 'Switched to ' + providerName(playback.provider) + '. Your place is preserved.' : 'Playing from ' + providerName(playback.provider));
      tryNextStream();
    }, 120000);
  }
  function stopEngine() {
    playbackGeneration++; clearTimeout(startupTimer); clearTimeout(bufferingTimer); clearTimeout(subtitleTimer); setText('subtitle', '');
    if (hls) { hls.destroy(); hls = null; }
    if (av) { try { av.stop(); } catch (e) {} try { av.close(); } catch (e2) {} }
    video.pause(); video.removeAttribute('src');
    while (video.firstChild) { video.removeChild(video.firstChild); }
    try { video.load(); } catch (e3) {}
    if (state.player) { state.player.cues = []; }
    screenSaver(true);
  }
  function tryNextStream() {
    var playback = state.player;
    if (!playback) { return; }
    stopEngine(); playback.sourceIndex++;
    if (playback.sourceIndex >= playback.sources.length) { switchSource(false); return; }
    playback.started = false; playback.complete = false; playback.subtitleIndex = -1;
    setText('captions-button', 'Subtitles: off');
    var source = playback.sources[playback.sourceIndex];
    if (!source.url || !/^https?:\/\//i.test(source.url)) { tryNextStream(); return; }
    showPlayerMessage('Opening ' + providerName(playback.provider) + '…');
    var generation = playbackGeneration;
    startupTimer = setTimeout(function () { if (state.player && generation === playbackGeneration && !state.player.started) { streamError('The stream did not start in time.'); } }, 35000);
    if (av) { playAV(source, generation); } else { playHTML(source, generation); }
  }
  function streamStarted() {
    if (!state.player) { return; }
    clearTimeout(startupTimer); clearTimeout(bufferingTimer); state.player.started = true; state.player.paused = false; hide('player-loading', true); setText('toggle-play', 'Pause'); showControls();
    updateTime(state.player.position, state.player.duration);
    screenSaver(false);
  }
  function playAV(source, generation) {
    try {
      av.open(source.url);
      av.setDisplayRect(0, 0, 1920, 1080);
      try { av.setDisplayMethod('PLAYER_DISPLAY_MODE_LETTER_BOX'); } catch (displayError) {}
      av.setListener({
        onbufferingstart: function () { if (generation === playbackGeneration && state.player) { watchBuffering(generation); } },
        onbufferingprogress: function (percent) { if (generation === playbackGeneration && state.player) { setText('player-message', 'Buffering… ' + percent + '%'); } },
        onbufferingcomplete: function () { if (generation === playbackGeneration && state.player) { clearTimeout(bufferingTimer); hide('player-loading', true); } },
        oncurrentplaytime: function (milliseconds) { if (generation === playbackGeneration && state.player) { var duration = 0; try { duration = av.getDuration() / 1000; } catch (e) {} updateTime(milliseconds / 1000, duration); } },
        onstreamcompleted: function () { if (generation === playbackGeneration) { completeEpisode(); } },
        onerror: function (error) { if (generation === playbackGeneration) { streamError('TV playback error: ' + error); } }
      });
      // Samsung requires an absolute local path for setExternalSubtitlePath().
      // Render remote WebVTT/SRT captions ourselves instead of handing it a URL.
      try { av.setSilentSubtitle(true); } catch (subtitleError) {}
      var subtitle = preferredSubtitle(source.subtitles || []);
      if (subtitle >= 0) { loadSubtitle(subtitle, generation); }
      av.prepareAsync(function () {
        if (!state.player || generation !== playbackGeneration) { return; }
        var position = state.player.position;
        function playNow() { if (generation !== playbackGeneration || !state.player) { return; } try { av.play(); streamStarted(); } catch (e) { streamError(e.message || 'The TV could not start this stream.'); } }
        try { var duration = av.getDuration() / 1000; state.player.duration = duration; if (position > 0 && (!duration || position < duration - 2)) { av.seekTo(Math.floor(position * 1000), playNow, playNow); } else { playNow(); } } catch (e) { playNow(); }
      }, function () { if (generation === playbackGeneration) { streamError('The TV could not prepare this stream.'); } });
    } catch (error) { streamError(error.message || 'The TV does not support this stream.'); }
  }
  function preferredSubtitle(subtitles) { var i; for (i = 0; i < subtitles.length; i++) { if (/english|^en(?:g)?(?:-|$)/i.test(subtitles[i].language || subtitles[i].label || '')) { return i; } } return subtitles.length ? 0 : -1; }
  function subtitleLabel(subtitle) { return subtitle.label || subtitle.language || 'On'; }
  function playHTML(source, generation) {
    var subtitles = source.subtitles || [];
    video.crossOrigin = 'anonymous';
    video.onloadedmetadata = function () {
      if (!state.player || generation !== playbackGeneration) { return; }
      if (state.player.position > 0) { try { video.currentTime = state.player.position; } catch (e) {} }
      var subtitle = preferredSubtitle(subtitles); if (subtitle >= 0) { loadSubtitle(subtitle, generation); }
      playBrowserVideo(generation);
    };
    video.onplaying = function () { if (generation === playbackGeneration && state.player) { streamStarted(); } };
    video.onwaiting = function () { if (generation === playbackGeneration && state.player) { watchBuffering(generation); } };
    video.ontimeupdate = function () { if (generation === playbackGeneration && state.player) { updateTime(video.currentTime, isFinite(video.duration) ? video.duration : 0); } };
    video.onended = function () { if (generation === playbackGeneration) { completeEpisode(); } };
    video.onerror = function () { if (generation === playbackGeneration && state.player && video.getAttribute('src')) { streamError('The browser could not play this stream' + (video.error ? ' (media error ' + video.error.code + ')' : '') + '.'); } };
    if (source.type === 'hls' || /\.m3u8(?:\?|$)/i.test(source.url)) {
      if (window.Hls && window.Hls.isSupported()) {
        hls = new window.Hls({ enableWorker: true, maxBufferLength: 30 });
        hls.on(window.Hls.Events.ERROR, function (event, data) { if (data.fatal && generation === playbackGeneration && state.player) { streamError('The HLS stream could not be loaded (' + (data.details || data.type || 'unknown error') + ').'); } });
        hls.loadSource(source.url); hls.attachMedia(video);
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) { video.src = source.url; video.load(); }
      else { streamError('HLS playback is unavailable in this browser. Use the Samsung app or a browser with HLS support.'); }
    } else { video.src = source.url; video.load(); }
  }
  function playBrowserVideo(generation) {
    try {
      var result = video.play();
      if (result && result['catch']) { result['catch'](function (error) { if (generation !== playbackGeneration || !state.player) { return; } if (error && error.name === 'NotAllowedError') { clearTimeout(startupTimer); state.player.paused = true; hide('player-loading', true); setText('toggle-play', 'Play'); setText('player-status', 'Select Play to start this episode.'); showControls(); focusFirst('#toggle-play'); } else if (!error || error.name !== 'AbortError') { streamError('The browser could not start playback.'); } }); }
    } catch (e) { streamError('The browser could not start playback.'); }
  }
  function streamError(reason) {
    if (!state.player || state.player.recovering) { return; }
    if (window.console && window.console.warn) { window.console.warn('AniHarbor playback: ' + reason); }
    state.player.failures++;
    if (state.player.failures > 18) { playbackFailed(reason + ' No more streams will be tried.'); return; }
    setText('player-status', reason + ' Trying another stream…');
    tryNextStream();
  }
  function watchBuffering(generation) {
    showPlayerMessage('Buffering…'); clearTimeout(bufferingTimer);
    bufferingTimer = setTimeout(function () { if (state.player && generation === playbackGeneration && !state.player.paused) { streamError('The stream stopped responding.'); } }, 35000);
  }
  function switchSource(manual) {
    var playback = state.player;
    if (!playback || playback.recovering) { return; }
    if (playback.excluded.indexOf(playback.provider) < 0) { playback.excluded.push(playback.provider); }
    stopEngine();
    if (playback.excluded.length >= Math.max(state.providers.length, 1) || playback.excluded.length >= 12) { playbackFailed('No more sources are available for this episode. Try another language or search for the series on a different source.'); return; }
    showPlayerMessage(manual ? 'Looking for another source…' : 'This source could not play. Trying a backup…'); showControls(); resolveEpisode();
  }
  function playbackFailed(reason) { stopEngine(); if (!state.player) { return; } state.player.paused = true; state.player.recovering = false; state.player.started = false; showPlayerMessage(reason, true); setText('player-status', 'Use Back to return to the episode list.'); setText('toggle-play', 'Retry'); showControls(); focusFirst('#toggle-play'); }
  function updateTime(position, duration) {
    if (!state.player) { return; }
    state.player.position = position; state.player.duration = duration || state.player.duration;
    renderSubtitle(position);
    setText('player-time', clock(position) + ' / ' + clock(state.player.duration));
    byId('progress-fill').style.width = (state.player.duration ? Math.min(100, position / state.player.duration * 100) : 0) + '%';
    if (Date.now() - lastSave > 5000) { saveProgress(); }
  }
  function saveProgress() { if (!state.player) { return; } var playback = state.player; if (playback.position < 1 && !playback.complete) { return; } var seasons = playback.show.seasons || [], i, j, legacyKey; for (i = 0; i < seasons.length; i++) { if (seasons[i].id === playback.seasonId) { for (j = 0; j < seasons[i].providers.length; j++) { legacyKey = seriesKey(seasons[i].providers[j]); if (progress[legacyKey]) { delete progress[legacyKey]; } } } } progress[showKey(playback.show) + ':season:' + playback.seasonId] = { show: playback.show, seasonId: playback.seasonId, series: playback.series, episode: playback.episode, language: playback.language, position: playback.position, duration: playback.duration, completed: playback.complete, updated: Date.now() }; writeStore('progress', progress); lastSave = Date.now(); }
  function completeEpisode() { if (!state.player) { return; } state.player.complete = true; state.player.paused = true; saveProgress(); screenSaver(true); hide('player-loading', true); setText('toggle-play', 'Replay'); setText('player-status', findNextEpisode() ? 'Episode complete. Ready for the next one?' : 'Episode complete.'); showControls(); if (findNextEpisode()) { focusFirst('#next-episode'); } else { focusFirst('#toggle-play'); } }
  function togglePlay() {
    var playback = state.player;
    if (!playback || playback.recovering) { return; }
    if (playback.complete) { startEpisode(playback.episode, 0); return; }
    if (!playback.started && hasClass(byId('player-loading'), 'error')) { playback.excluded = []; playback.failures = 0; showPlayerMessage('Trying the episode again…'); resolveEpisode(); return; }
    try {
      if (playback.paused) { if (av) { av.play(); } else { playBrowserVideo(playbackGeneration); } playback.paused = false; }
      else { if (av) { av.pause(); } else { video.pause(); } playback.paused = true; saveProgress(); }
      screenSaver(playback.paused); setText('toggle-play', playback.paused ? 'Play' : 'Pause'); showControls();
    } catch (e) { toast('Playback is not ready yet.'); }
  }
  function seek(delta) {
    if (!state.player || !state.player.started || !state.player.duration) { return; }
    var position = Math.max(0, Math.min(state.player.duration - 1, state.player.position + delta));
    try { if (av) { av.seekTo(Math.floor(position * 1000), function () {}, function () { toast('This stream cannot seek to that position.'); }); } else { video.currentTime = position; } updateTime(position, state.player.duration); showControls(); } catch (e) { toast('This stream cannot seek to that position.'); }
  }
  function cycleCaptions() {
    if (!state.player) { return; }
    var source = state.player.sources[state.player.sourceIndex], subtitles = source && source.subtitles || [];
    if (!subtitles.length) { toast('This stream does not include selectable subtitles.'); return; }
    var next = state.player.subtitleIndex + 1; if (next >= subtitles.length) { next = -1; }
    loadSubtitle(next, playbackGeneration); showControls();
  }
  function loadSubtitle(index, generation) {
    if (!state.player || generation !== playbackGeneration) { return; }
    var source = state.player.sources[state.player.sourceIndex], subtitles = source && source.subtitles || [];
    state.player.subtitleIndex = index; state.player.cues = []; setText('subtitle', '');
    setText('captions-button', index < 0 ? 'Subtitles: off' : 'Subtitles: ' + subtitleLabel(subtitles[index]));
    if (index < 0) { return; }
    var xhr = new XMLHttpRequest();
    try {
      xhr.open('GET', subtitles[index].url, true); xhr.timeout = 18000;
      xhr.onload = function () {
        if (!state.player || generation !== playbackGeneration || state.player.subtitleIndex !== index) { return; }
        if (xhr.status < 200 || xhr.status >= 300) { toast('This subtitle track could not be loaded.'); return; }
        state.player.cues = parseSubtitles(xhr.responseText);
        if (!state.player.cues.length) { toast('This subtitle format is not supported. Choose a WebVTT or SRT track.'); }
        renderSubtitle(state.player.position);
      };
      xhr.onerror = xhr.ontimeout = function () { if (state.player && generation === playbackGeneration) { toast('This subtitle track could not be loaded.'); } };
      xhr.send();
    } catch (e) { toast('This subtitle track could not be loaded.'); }
  }
  function parseSubtitles(text) {
    var blocks = String(text || '').replace(/^\uFEFF/, '').replace(/\r/g, '').split(/\n\s*\n/), cues = [], i, j, lines, timing, payload, decode = document.createElement('textarea');
    function seconds(time) { var parts = time.replace(',', '.').split(':'), result = 0, p; for (p = 0; p < parts.length; p++) { result = result * 60 + parseFloat(parts[p]); } return result; }
    for (i = 0; i < blocks.length; i++) {
      lines = blocks[i].split('\n');
      for (j = 0; j < Math.min(lines.length, 3); j++) {
        timing = lines[j].match(/((?:\d+:)?\d{2}:\d{2}[.,]\d+)\s*-->\s*((?:\d+:)?\d{2}:\d{2}[.,]\d+)/);
        if (timing) { payload = lines.slice(j + 1).join('\n').replace(/<[^>]*>/g, '').replace(/\{\\[^}]*\}/g, ''); decode.innerHTML = payload; cues.push({ start: seconds(timing[1]), end: seconds(timing[2]), text: decode.value }); break; }
      }
    }
    cues.sort(function (a, b) { return a.start - b.start; }); return cues;
  }
  function renderSubtitle(position) {
    if (!state.player || state.player.subtitleIndex < 0) { return; }
    var cues = state.player.cues || [], low = 0, high = cues.length - 1, middle, last = -1, text = [], i;
    while (low <= high) { middle = Math.floor((low + high) / 2); if (cues[middle].start <= position) { last = middle; low = middle + 1; } else { high = middle - 1; } }
    for (i = Math.max(0, last - 8); i <= last; i++) { if (cues[i].end > position) { text.push(cues[i].text); } }
    setText('subtitle', text.join('\n'));
  }
  function findNextEpisode() { if (!state.player) { return null; } var i, found = false; for (i = 0; i < state.episodes.length; i++) { if (found && (!state.episodes[i].languages || !state.episodes[i].languages || !state.episodes[i].languages.length || state.episodes[i].languages.indexOf(state.player.language) >= 0)) { return state.episodes[i]; } if (String(state.episodes[i].id) === String(state.player.episode.id)) { found = true; } } return null; }
  function showControls() { if (!state.player) { return; } clearTimeout(controlsTimer); toggleClass(playerElement, 'controls-hidden', false); toggleClass(playerElement, 'controls-visible', true); controlsTimer = setTimeout(function () { if (state.player && state.player.started && !state.player.paused && !state.player.complete && hasClass(byId('player-loading'), 'hidden')) { toggleClass(playerElement, 'controls-hidden', true); toggleClass(playerElement, 'controls-visible', false); } }, 6000); }
  function closePlayer() {
    if (!state.player) { return; }
    var episode = state.player.episode, i, count = 0, index = -1;
    saveProgress(); stopEngine(); clearTimeout(controlsTimer); state.player = null; hide('player', true); toggleClass(document.body, 'tv-active', false); toggleClass(document.documentElement, 'tv-active', false); byId('app').removeAttribute('aria-hidden');
    for (i = 0; i < state.episodes.length; i++) { if (state.episodes[i].languages && state.episodes[i].languages.length && state.episodes[i].languages.indexOf(state.language) < 0) { continue; } if (String(state.episodes[i].id) === String(episode.id)) { state.episodePage = Math.floor(count / 24); index = i; break; } count++; }
    drawDetail(false); focusFirst(index >= 0 ? '[data-action="play-episode"][data-index="' + index + '"]' : '#main .episode');
  }
  function action(name, element) {
    var index = element ? parseInt(element.getAttribute('data-index'), 10) : -1, list, history, section, episode;
    if (name === 'home' || name === 'search' || name === 'saved' || name === 'sources' || name === 'settings') { state.trail = []; }
    if (name === 'home') { renderHome(); }
    else if (name === 'search') { var previousProvider = state.provider; state.provider = 'auto'; renderSearch(previousProvider !== 'auto' && !!state.query); }
    else if (name === 'saved') { renderSaved(); }
    else if (name === 'sources') { renderSources(true); }
    else if (name === 'settings') { renderSettings(); }
    else if (name === 'all-providers') { state.provider = 'auto'; renderSearch(!!state.query); }
    else if (name === 'focus-search') { byId('search-input').focus(); }
    else if (name === 'retry-search') { performSearch(); }
    else if (name === 'refresh-sources') { renderSources(true); }
    else if (name === 'select-provider') { state.provider = state.providers[index].id; renderSearch(!!state.query); }
    else if (name === 'test-connection') { testConnection(); }
    else if (name === 'browse-section') { renderCollection(element.getAttribute('data-section'), 1, true); }
    else if (name === 'retry-recommended' || name === 'retry-new') { section = name.substring(6); byId('discover-' + section).innerHTML = loading('Loading…'); loadDiscover(section, true); }
    else if (name === 'collection-next' || name === 'collection-prev' || name === 'retry-collection') { renderCollection(state.collection.section, state.collection.page + (name === 'collection-next' ? 1 : name === 'collection-prev' ? -1 : 0), false); }
    else if (name === 'open-series') {
      list = element.getAttribute('data-list');
      if (list === 'continue') { history = listProgress()[index]; openSeries(history.show || history.series, history); }
      else if (list === 'saved') { openSeries(savedList()[index]); }
      else if (list === 'recommended' || list === 'new') { openSeries(state.discover[list + ':1'].results[index]); }
      else if (list === 'collection') { openSeries(state.discover[state.collection.section + ':' + state.collection.page].results[index]); }
      else { openSeries(state.results[index]); }
    }
    else if (name === 'back') { goBack(); }
    else if (name === 'retry-episodes') { selectDetailSource(false); focusFirst('[data-action="detail-provider"].selected'); }
    else if (name === 'select-season') { state.seasonIndex = index; state.providerIndex = 0; selectDetailSource(false); focusFirst('[data-action="select-season"].selected'); }
    else if (name === 'detail-provider') { state.providerIndex = index; selectDetailSource(false); focusFirst('[data-action="detail-provider"].selected'); }
    else if (name === 'focus-providers') { focusFirst('[data-action="detail-provider"].selected'); }
    else if (name === 'save-series') { toggleSaved(); }
    else if (name === 'language') { state.language = element.getAttribute('data-language'); state.episodePage = 0; drawDetail(state.episodesPending); focusFirst('#main .language-switch .selected'); }
    else if (name === 'search-series' || name === 'search-show') { state.query = state.show.title; state.provider = 'auto'; state.trail = []; renderSearch(true); }
    else if (name === 'resume') { history = selectedHistory(); episode = resumeEpisode(history); if (episode) { state.language = history.language || 'sub'; startEpisode(episode, history.position); } }
    else if (name === 'play-episode') { startEpisode(state.episodes[index]); }
    else if (name === 'jump-episode') { jumpEpisode(); }
    else if (name === 'episode-prev' || name === 'episode-next') { state.episodePage += name === 'episode-next' ? 1 : -1; drawEpisodes(); focusFirst('#episodes-content .episode'); }
    else if (name === 'close-player') { closePlayer(); }
    else if (name === 'toggle-play') { togglePlay(); }
    else if (name === 'rewind') { seek(-10); }
    else if (name === 'forward') { seek(10); }
    else if (name === 'captions') { cycleCaptions(); }
    else if (name === 'switch-source') { switchSource(true); }
    else if (name === 'next-episode') { var next = findNextEpisode(); if (next) { startEpisode(next, 0); } else { toast('No next episode is listed.'); } }
  }
  function parentRail(element) { while (element && element !== document.body) { if (hasClass(element, 'card-rail')) { return element; } element = element.parentNode; } return null; }
  function moveFocus(element) {
    var rail = parentRail(element), rect, bounds;
    if (rail) { rect = element.getBoundingClientRect(); bounds = rail.getBoundingClientRect(); if (rect.left < bounds.left + 12) { rail.scrollLeft -= bounds.left + 12 - rect.left; } else if (rect.right > bounds.right - 12) { rail.scrollLeft += rect.right - bounds.right + 12; } }
    element.focus(); rect = element.getBoundingClientRect(); if (!state.player && (rect.top < 24 || rect.bottom > window.innerHeight - 30)) { window.scrollBy(0, rect.top - window.innerHeight * 0.3); }
  }
  function navigateFocus(direction) {
    var root = state.player ? playerElement : document, focus = document.activeElement, rail = parentRail(focus), siblings, siblingIndex;
    if (rail && (direction === 'left' || direction === 'right')) { siblings = rail.querySelectorAll('.card'); siblingIndex = Array.prototype.indexOf.call(siblings, focus) + (direction === 'left' ? -1 : 1); if (siblings[siblingIndex]) { moveFocus(siblings[siblingIndex]); } return; }
    var elements = root.querySelectorAll('button:not([disabled]), input:not([disabled])'), candidates = [], i, element, rect, bounds, candidateRail;
    for (i = 0; i < elements.length; i++) { element = elements[i]; rect = element.getBoundingClientRect(); candidateRail = parentRail(element); bounds = candidateRail && candidateRail.getBoundingClientRect(); if (rect.width && rect.height && !hasHiddenParent(element) && (!bounds || (rect.left < bounds.right - 20 && rect.right > bounds.left + 20))) { candidates.push(element); } }
    if (!candidates.length) { return; }
    if (candidates.indexOf(focus) < 0) { moveFocus(candidates[0]); return; }
    var current = focus.getBoundingClientRect(), cx = current.left + current.width / 2, cy = current.top + current.height / 2, best = null, bestScore = Infinity;
    for (i = 0; i < candidates.length; i++) {
      element = candidates[i]; if (element === focus) { continue; } rect = element.getBoundingClientRect();
      var dx = rect.left + rect.width / 2 - cx, dy = rect.top + rect.height / 2 - cy, primary, secondary, overlap;
      if (direction === 'left' || direction === 'right') { if ((direction === 'left' && dx >= -4) || (direction === 'right' && dx <= 4)) { continue; } primary = Math.abs(dx); secondary = Math.abs(dy); overlap = rect.top < current.bottom && rect.bottom > current.top; }
      else { if ((direction === 'up' && dy >= -4) || (direction === 'down' && dy <= 4)) { continue; } primary = Math.abs(dy); secondary = Math.abs(dx); overlap = rect.left < current.right && rect.right > current.left; }
      var score = primary + secondary * (overlap ? 0.25 : 3) + (overlap ? 0 : 200);
      if (score < bestScore) { best = element; bestScore = score; }
    }
    if (best) { moveFocus(best); }
  }
  function hasHiddenParent(element) { while (element && element !== document.body) { if (hasClass(element, 'hidden')) { return true; } element = element.parentNode; } return false; }
  document.addEventListener('click', function (event) { var element = event.target; while (element && element !== document.body && !element.getAttribute('data-action')) { element = element.parentNode; } if (element && element.getAttribute && element.getAttribute('data-action') && !element.disabled) { action(element.getAttribute('data-action'), element); } });
  document.addEventListener('error', function (event) { if (event.target.tagName === 'IMG' && event.target.getAttribute('src') !== 'assets/placeholder.svg') { event.target.src = 'assets/placeholder.svg'; } }, true);
  document.addEventListener('keydown', function (event) {
    var code = event.keyCode || event.which, input = event.target && /INPUT|TEXTAREA/.test(event.target.tagName);
    if (input && window.tizen) {
      if (code === 65376 || code === 65385) { event.target.blur(); if (event.target.id === 'search-input') { if (code === 65376) { performSearch(); } focusFirst('#search-form button[type="submit"]'); } else if (event.target.id === 'episode-jump') { if (code === 65376) { jumpEpisode(); } else { focusFirst('[data-action="jump-episode"]'); } } else { focusFirst('#settings-form button[type="submit"]'); } return; }
      return;
    }
    if (code === 13 && event.target && event.target.id === 'episode-jump') { event.preventDefault(); jumpEpisode(); return; }
    if (code === 10009 || code === 27 || (code === 8 && !input)) { event.preventDefault(); goBack(); return; }
    if (state.player) {
      if (code === 415 || code === 19 || code === 10252 || code === 32) { event.preventDefault(); if ((code === 415 && state.player.paused) || (code === 19 && !state.player.paused) || code === 10252 || code === 32) { togglePlay(); } showControls(); return; }
      if (code === 413) { event.preventDefault(); closePlayer(); return; }
      if (code === 417 || code === 412) { event.preventDefault(); seek(code === 417 ? 30 : -30); return; }
      if (hasClass(playerElement, 'controls-hidden') && (code >= 37 && code <= 40 || code === 13)) { event.preventDefault(); showControls(); focusFirst('#toggle-play'); return; }
      showControls();
    }
    if (code >= 37 && code <= 40) { if (input && (code === 37 || code === 39)) { return; } event.preventDefault(); navigateFocus({ 37: 'left', 38: 'up', 39: 'right', 40: 'down' }[code]); }
  });
  document.addEventListener('visibilitychange', function () { if (document.hidden && state.player && state.player.started && !state.player.paused) { togglePlay(); } });
  window.addEventListener('beforeunload', function () { saveProgress(); stopEngine(); });
  playerElement.addEventListener('mousemove', showControls);
  if (window.tizen && window.tizen.tvinputdevice) { var mediaKeys = ['MediaPlay', 'MediaPause', 'MediaPlayPause', 'MediaStop', 'MediaFastForward', 'MediaRewind'], k; for (k = 0; k < mediaKeys.length; k++) { try { window.tizen.tvinputdevice.registerKey(mediaKeys[k]); } catch (e) {} } }
  renderHome();
  refreshProviders(function () { if (state.view === 'home') { var snapshot = rememberView(); restoreView(snapshot); } });
}());
