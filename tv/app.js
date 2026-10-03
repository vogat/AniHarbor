(function () {
  'use strict';
  var STORE = 'aniharbor.v1';
  var main = document.getElementById('main');
  var video = document.getElementById('video');
  var playerElement = document.getElementById('player');
  var state = { view: 'home', providers: [], provider: 'auto', query: '', results: [], series: null, episodes: [], language: 'sub', online: false, requestId: 0, player: null, lastView: 'home', searches: [], show: null, seasonIndex: 0, providerIndex: 0, episodePage: 0, episodesPending: false, discover: {}, discoverLoaded: {}, collection: { section: 'recommended', page: 1 }, trail: [], detailId: 0 };
  var DISCOVER_TTL = 5 * 60 * 1000;
  var settings = readStore('settings', { server: '', token: '' });
  if (/^#token=/.test(window.location.hash)) {
    try { settings.server = ''; settings.token = decodeURIComponent(window.location.hash.substring(7)); writeStore('settings', settings); window.history.replaceState(null, '', window.location.pathname + window.location.search); } catch (bootstrapError) {}
  }
  var saved = readStore('saved', {});
  var progress = readStore('progress', {});
  var mediaProgress = readStore('media-progress', {});
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
  function imageUrl(url) { if (PosterState.durable(url)) { return PosterState.rebase(url, settings.server || window.location.origin); } return /^https?:\/\//i.test(url || '') ? url : 'assets/placeholder.svg'; }
  function setText(id, text) { byId(id).textContent = text; }
  var posterEntries = {}, posterBusy = false;
  function posterTag(item, className, lazy) {
    var key = showKey(item), entry = posterEntries[key];
    if (!entry) { entry = posterEntries[key] = { item:item, next:0 }; }
    if (PosterState.durable(item.image)) { entry.image = item.image; }
    return '<img' + (className ? ' class="' + className + '"' : '') + ' data-poster-key="' + escapeHtml(key) + '" src="' + escapeHtml(imageUrl(entry.image || item.image)) + '" alt=""' + (lazy ? ' loading="lazy"' : '') + '>';
  }
  function repairPosters() {
    if (posterBusy || state.player || document.hidden || !state.online) { return; }
    var images = main.querySelectorAll('img[data-poster-key]'), image, entry, i, key;
    for (i = 0; i < images.length; i++) {
      image = images[i]; key = image.getAttribute('data-poster-key'); entry = posterEntries[key];
      if (!entry || entry.next > Date.now() || (PosterState.durable(image.getAttribute('src')) && !image.getAttribute('data-poster-failed'))) { continue; }
      var item = entry.item, selected = item.seasons && item.seasons[0] && item.seasons[0].providers && item.seasons[0].providers[0] || item;
      posterBusy = true; entry.next = Date.now() + 60000;
      (function (posterKey, target, source) {
        api('/api/artwork', { title:target.title, year:target.year || '', provider:source.provider || '', id:source.id || target.id || '' }, function (error, data) {
          var current = posterEntries[posterKey], nodes = main.querySelectorAll('img[data-poster-key]'), n;
          if (!error && data && PosterState.durable(data.image)) {
            current.image = data.image; current.next = Date.now() + 60000;
            progress = readStore('progress', progress); saved = readStore('saved', saved); mediaProgress = readStore('media-progress', mediaProgress);
            PosterState.repair(progress,target,data.image); PosterState.repair(saved,target,data.image); PosterState.repair(mediaProgress,target,data.image);
            PosterState.repair(current.item,target,data.image);
            writeStore('progress',progress); writeStore('saved',saved); writeStore('media-progress',mediaProgress);
            for (n = 0; n < nodes.length; n++) { if (nodes[n].getAttribute('data-poster-key') === posterKey) { nodes[n].removeAttribute('data-poster-failed'); nodes[n].src = imageUrl(data.image); } }
          }
          // Bound retries and metadata traffic. A failed image is retried, not permanently replaced.
          setTimeout(function () { posterBusy = false; repairPosters(); }, 1200);
        }, 45000);
      })(key,item,selected);
      return;
    }
  }
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
    return { view: state.view, library: state.library, sports: state.sportsFilters, sportsCollection: state.sportsCollection, collection: { section: state.collection.section, page: state.collection.page }, focus: focus && (focus.getAttribute('data-focus') || focus.id), scroll: window.pageYOffset || 0, rails: positions };
  }
  function restoreView(snapshot) {
    if (!snapshot) { return; }
    if (snapshot.view === 'sports-collection') { sportsCollection(snapshot.sportsCollection.league, snapshot.sportsCollection.page, snapshot); } else if (snapshot.view === 'sports') { renderSports(snapshot); } else if (snapshot.view === 'media') { renderLibrary(snapshot.library.section, snapshot.library.page, snapshot.library.q, snapshot); } else if (snapshot.view === 'search') { renderSearch(false); } else if (snapshot.view === 'saved') { renderSaved(); } else if (snapshot.view === 'collection') { renderCollection(snapshot.collection.section, snapshot.collection.page, false); } else if (snapshot.view === 'sources') { renderSources(false); } else { renderHome(); }
    setTimeout(function () { var elements = document.querySelectorAll('[data-focus]'), target = byId(snapshot.focus), i, key; for (i = 0; i < elements.length; i++) { if (elements[i].getAttribute('data-focus') === snapshot.focus) { target = elements[i]; break; } } if (target) { target.focus(); } for (key in snapshot.rails) { if (byId(key)) { byId(key).scrollLeft = snapshot.rails[key]; } } window.scrollTo(0, snapshot.scroll); }, 45);
  }
  function providerName(id) { var i; for (i = 0; i < state.providers.length; i++) { if (state.providers[i].id === id) { return state.providers[i].name; } } return id === 'auto' ? 'All sources' : (id || 'Unknown source'); }
  function messageFrom(error) { if (!error) { return 'The request could not be completed.'; } return typeof error === 'string' ? error : (error.message || error.error || 'The request could not be completed.'); }
  function clock(seconds) { seconds = Math.max(0, Math.floor(seconds || 0)); var hours = Math.floor(seconds / 3600); var minutes = Math.floor((seconds % 3600) / 60); var secs = seconds % 60; return (hours ? hours + ':' + (minutes < 10 ? '0' : '') : '') + minutes + ':' + (secs < 10 ? '0' : '') + secs; }
  function niceDate(value) { var m = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/), months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; if (!m) { return ''; } return months[Number(m[2]) - 1] + ' ' + Number(m[3]) + ', ' + m[1]; }
  function detailValue(show, season, key) { return season && season[key] !== undefined && season[key] !== null && season[key] !== '' ? season[key] : show[key]; }
  function detailFacts(show, season) {
    var facts = [], start = niceDate(detailValue(show, season, 'releaseDate')), end = niceDate(detailValue(show, season, 'endDate')), episodes = detailValue(show, season, 'episodeCount'), status = detailValue(show, season, 'status'), score = detailValue(show, season, 'score'), studios = detailValue(show, season, 'studios') || [], source = detailValue(show, season, 'sourceMaterial'), genres = detailValue(show, season, 'genres') || [];
    if (start) { facts.push('<span class="detail-fact"><b>Aired</b> ' + escapeHtml(start + (end && end !== start ? ' – ' + end : '')) + '</span>'); }
    if (episodes) { facts.push('<span class="detail-fact"><b>Episodes</b> ' + escapeHtml(episodes) + '</span>'); }
    if (status) { facts.push('<span class="detail-fact"><b>Status</b> ' + escapeHtml(status) + '</span>'); }
    if (score) { facts.push('<span class="detail-fact"><b>MAL</b> ' + escapeHtml(Number(score).toFixed(2).replace(/0+$/, '').replace(/\.$/, '')) + '</span>'); }
    if (studios.length) { facts.push('<span class="detail-fact"><b>Studio</b> ' + escapeHtml(studios.join(', ')) + '</span>'); }
    if (source) { facts.push('<span class="detail-fact"><b>Source</b> ' + escapeHtml(source) + '</span>'); }
    return (facts.length ? '<div class="detail-facts">' + facts.join('') + '</div>' : '') + (genres.length ? '<div class="detail-genres">' + genres.map(function (genre) { return '<span>' + escapeHtml(genre) + '</span>'; }).join('') + '</div>' : '');
  }
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
  function activeFamilies() { var seen = {}, count = 0, i, family; for (i = 0; i < state.providers.length; i++) { if (state.providers[i].disabled) { continue; } family = state.providers[i].family || state.providers[i].id; if (!seen[family]) { seen[family] = true; count++; } } return count; }
  function focusFirst(selector) { var request = state.requestId; setTimeout(function () { if (request !== state.requestId) { return; } var target = document.querySelector(selector || '#main button:not([disabled]), #main input'); if (target && !hasHiddenParent(target)) { target.focus(); } }, 20); }
  function setView(view) { state.view = view; state.requestId++; var navs = document.querySelectorAll('.nav-button, .settings-button'), i; for (i = 0; i < navs.length; i++) { toggleClass(navs[i], 'active', navs[i].id === 'nav-' + (view === 'collection' ? 'home' : view === 'game-detail' || view === 'sports-collection' ? 'sports' : view === 'media-detail' ? 'media' : view)); } window.scrollTo(0, 0); }
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
      html += '<button class="card" data-action="open-series" data-focus="card-' + mode + '-' + escapeHtml(showKey(series)) + '" data-list="' + mode + '" data-index="' + i + '"><span class="poster">' + posterTag(series, '', true) + '<span class="card-tag">' + escapeHtml(mode === 'continue' ? 'EP ' + (item.episode.number || '?') + ' · ' + clock(item.position) : cardSummary(series)) + '</span>' + (mode === 'continue' ? '<span class="card-progress" style="width:' + percent + '%"></span>' : '') + '</span><span class="card-title">' + escapeHtml(series.title) + '</span><span class="card-subtitle">' + escapeHtml(mode === 'continue' ? (item.completed ? 'Episode completed · choose what is next' : 'Continue episode ' + item.episode.number) : [series.year || '', series.kind === 'movie' ? 'Movie' : 'Series'].join(' · ').replace(/^ · /, '')) + '</span></button>';
    }
    return html + '</div>';
  }
  function sectionTitle(section) { return section === 'new' ? 'Newly released' : 'Recommended'; }
  function discoverSection(section) { return '<section class="discover-section"><div class="section-heading"><h2>' + sectionTitle(section) + '</h2><span>' + (section === 'new' ? 'Latest episode additions' : 'Popular picks to explore') + '</span><button class="button subtle small" data-action="browse-section" data-section="' + section + '" data-focus="browse-' + section + '">View all &#8594;</button></div><div id="discover-' + section + '">' + loading('Finding your next show…') + '</div></section>'; }
  function feedDescription(data) { return data.description ? '<p class="catalog-note">' + (data.stale ? 'Showing cached results. ' : '') + escapeHtml(data.description) + '</p>' : ''; }
  function drawDiscover(section, data, error) { var container = byId('discover-' + section); if (!container) { return; } if (error) { container.innerHTML = empty('This row could not load', messageFrom(error), 'retry-' + section, 'Try again', true); return; } container.innerHTML = feedDescription(data) + (data.results.length ? cards(data.results, section, true) : empty('No titles available yet', 'Check back when the catalog has new recommendations.')); }
  function loadDiscover(section, force) {
    var key = section + ':1', cached = state.discover[key], request = state.requestId, fresh = cached && Date.now() - (state.discoverLoaded[key] || 0) < DISCOVER_TTL;
    if (cached && !force) { drawDiscover(section, cached); if (fresh) { return; } }
    api('/api/discover', { section: section, page: 1 }, function (error, data) { if (!error) { state.discover[key] = data; state.discoverLoaded[key] = Date.now(); } if (state.view === 'home' && request === state.requestId) { if (!error || !cached) { var snapshot = rememberView(); drawDiscover(section, data, error); restoreFocus(snapshot); } } }, 60000);
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
    function draw(error, data, background) {
      var snapshot = background ? rememberView() : null;
      if (state.view !== 'collection' || request !== state.requestId) { return; }
      if (error && background && state.discover[key]) { return; }
      if (error) { byId('collection-content').innerHTML = empty('This page could not load', messageFrom(error), 'retry-collection', 'Try again', true); focusFirst('#collection-content button'); return; }
      state.discover[key] = data;
      byId('collection-content').innerHTML = feedDescription(data) + (data.results.length ? cards(data.results, 'collection') : empty('No more titles here', 'Return to the previous page to keep exploring.')) + '<div class="pagination"><button class="button subtle" data-action="collection-prev" data-focus="collection-prev"' + (state.collection.page < 2 ? ' disabled' : '') + '>&#8592; Previous page</button><span>Page ' + state.collection.page + '</span><button class="button subtle" data-action="collection-next" data-focus="collection-next"' + (!data.hasNextPage ? ' disabled' : '') + '>Next page &#8594;</button></div>';
      if (background) { restoreFocus(snapshot); } else { focusFirst('#collection-content .card, #collection-content button:not([disabled])'); }
    }
    if (state.discover[key]) {
      var cached = state.discover[key], fresh = Date.now() - (state.discoverLoaded[key] || 0) < DISCOVER_TTL;
      draw(null, cached);
      if (!fresh) { refreshCollection(true); }
    } else { refreshCollection(false); }
    function refreshCollection(background) { api('/api/discover', { section: section, page: state.collection.page }, function (error, data) { if (!error) { state.discoverLoaded[key] = Date.now(); } draw(error, data, background); }, 60000); }
    state.refreshCollection = function () { refreshCollection(true); };
  }
  function libraryCards(items, list, rail, offset) {
    var html = '<div class="cards library-cards' + (rail ? ' card-rail' : '') + '" id="media-rail-' + (list || 'browse') + '">', i, item, resume, percentage;
    for (i = 0; i < items.length; i++) { item = items[i]; resume = item.resume; percentage = resume && resume.duration ? Math.min(100, resume.position / resume.duration * 100) : 0;
      html += '<button class="card' + (item.kind === 'live' ? ' channel-card' : '') + '" data-action="open-media" data-list="' + (list || 'browse') + '" data-index="' + (i + (offset || 0)) + '" data-focus="media-' + (list || 'browse') + '-' + escapeHtml(item.id) + '"><span class="poster">' + (item.kind === 'live' ? '<span class="channel-symbol">&#9654;</span><span class="channel-name">' + escapeHtml(item.title) + '</span>' : posterTag(item, '', false)) + '<span class="card-tag">' + (resume ? 'RESUME' : item.kind === 'live' ? 'LIVE' : item.kind === 'movie' ? 'MOVIE' : 'TV EPISODE') + '</span></span>' + (resume ? '<span class="resume-track"><span style="width:' + percentage + '%"></span></span>' : '') + '<span class="card-title">' + escapeHtml(item.title) + '</span><span class="card-subtitle">' + escapeHtml(resume ? 'Resume at ' + clock(resume.position) : item.year || item.country || item.provider) + '</span>' + (resume && resume.part ? '<span class="card-subtitle">' + escapeHtml(resume.part.title) + '</span>' : '') + (item.reason ? '<span class="recommendation-reason">' + escapeHtml(item.reason) + '</span>' : '') + '</button>';
    }
    return html + '</div>';
  }
  function mediaTabs(section) {
    return '<div class="library-tabs">' + [['home','For you'],['channels','Live channels'],['movies','Movies on demand'],['tv','TV on demand']].map(function (c) { return '<button class="button' + (section === c[0] ? ' selected' : ' subtle') + '" data-action="library-section" data-section="' + c[0] + '" data-focus="library-' + c[0] + '" aria-pressed="' + (section === c[0]) + '">' + c[1] + '</button>'; }).join('') + '</div>';
  }
  function mediaRow(title, name, items, viewAll) {
    state.mediaLists[name] = items;
    return '<section class="discover-section"><div class="section-heading"><h2>' + escapeHtml(title) + '</h2>' + (viewAll ? '<button class="button subtle" data-action="media-collection" data-section="' + name + '" data-focus="all-' + name + '">View all &#8594;</button>' : '') + '</div>' + (items.length ? libraryCards(items.slice(0,12), name, true) : empty(name === 'continue' ? 'Your next watch starts here' : 'No suggestions yet', name === 'continue' ? 'Start a movie or TV episode. Come back here to resume it.' : 'Browse Movies or TV above to find something to watch.')) + '</section>';
  }
  function mediaHomeRows(data) {
    var continued = MediaHistory.continuing(mediaProgress).map(function (h) { var item = {}; Object.keys(h.item).forEach(function (k) { item[k] = h.item[k]; }); item.resume = h; return item; });
    var ranked = MediaHistory.recommend(data.results || [], mediaProgress), suggestions = ranked.map(function (r) { var item = {}; Object.keys(r.item).forEach(function (k) { item[k] = r.item[k]; }); item.reason = r.reason; return item; });
    var personalized = ranked.some(function (r) { return r.score > 0; });
    state.mediaLists = {}; state.mediaSuggestions = suggestions;
    return mediaRow('Continue watching', 'continue', continued, true) + mediaRow(personalized ? 'Recommended for you' : 'Popular classics to start with', 'recommended', suggestions, true) + '<p class="catalog-note">' + (personalized ? 'Suggestions reflect genres and creators in your viewing history.' : 'Watch a movie or TV episode to build recommendations around your interests.') + ' Viewing history stays on this device; titles are looked up by your local server. Live channels do not save a resume position.</p>' + (data.errors && data.errors.length ? '<p class="catalog-note" role="status">' + escapeHtml(data.errors.join(' ')) + '</p><button class="button subtle" data-action="library-retry">Refresh suggestions</button>' : '');
  }
  function renderMediaHome(section, restore) {
    state.library = { section: section || 'home', page: 1, q: '', results: [] }; setView('media');
    var request = state.requestId, ids = [], initial = state.mediaHomeData || { results: [] }, loaded = !!state.mediaHomeData;
    main.innerHTML = heading('TV & Movies', 'Pick up where you left off. Find your next favorite.') + mediaTabs('home') + '<div id="media-home">' + mediaHomeRows(initial) + '</div>';
    if (!loaded) { main.innerHTML += '<div id="media-home-loading">' + loading('Finding titles for you…') + '</div>'; }
    MediaHistory.entries(mediaProgress).forEach(function (h) { if (ids.indexOf(h.item.id) < 0 && ids.length < 12) { ids.push(h.item.id); } });
    if (section === 'continue' || section === 'recommended') { drawMediaCollection(section, restore && restore.library ? restore.library.page : 1, restore); } else if (restore) { restoreFocus(restore); } else { focusFirst(main.querySelector('#media-home .card') ? '#media-home .card' : '#main [data-section="movies"]'); }
    api('/api/library/home', { ids: JSON.stringify(ids) }, function (error, data) {
      if (error) { if (state.view === 'media' && request === state.requestId) { var loadingBox = byId('media-home-loading'); if (loadingBox) { loadingBox.innerHTML = empty('Suggestions could not load', messageFrom(error), 'library-retry', 'Try again', true); } else { toast(messageFrom(error)); } } return; }
      (data.history || []).forEach(function (entry) { Object.keys(mediaProgress).forEach(function (key) { if (key.indexOf(entry.id + ':') !== 0) { return; } var h = mediaProgress[key], partId = key.substring(entry.id.length + 1); if (entry.item) { h.item = entry.item; } var parts = entry.episodes || []; for (var i = 0; i < parts.length; i++) { if (parts[i].id === partId) { h.part = parts[i]; break; } } }); });
      writeStore('media-progress', mediaProgress); state.mediaHomeData = data;
      if (state.view !== 'media' || request !== state.requestId) { return; }
      var snapshot = rememberView();
      if (byId('media-home-loading')) { byId('media-home-loading').parentNode.removeChild(byId('media-home-loading')); }
      if (byId('media-home')) { byId('media-home').innerHTML = mediaHomeRows(data); }
      else { mediaHomeRows(data); drawMediaCollection(state.library.section, state.library.page, snapshot); return; }
      restoreFocus(snapshot);
    }, 90000);
  }
  function drawMediaCollection(section, page, restore) {
    state.library = { section: section, page: page || 1, q: '', results: [] };
    var items = state.mediaLists[section] || [], start = (state.library.page - 1) * 24;
    main.innerHTML = '<button class="back-button" data-action="media-home-back">&#8592; Back to TV & Movies</button>' + heading(section === 'continue' ? 'Continue watching' : 'Recommended for you', section === 'continue' ? 'Resume a movie or episode from your saved position.' : 'Suggestions from your viewing history, with popular classics when there is no match.') + libraryCards(items.slice(start,start + 24), section, false, start) + (items.length ? '<div class="pagination"><button class="button" data-action="media-collection-prev"' + (!start ? ' disabled' : '') + '>Previous page</button><span>Page ' + state.library.page + '</span><button class="button" data-action="media-collection-next"' + (start + 24 >= items.length ? ' disabled' : '') + '>Next page</button></div>' : empty('Nothing here yet', 'Browse Movies or TV to start watching.'));
    if (restore) { restoreFocus(restore); } else { focusFirst(main.querySelector('.card') ? '#main .card' : '#main .back-button'); }
  }
  function sportsDay(offset) { var d = new Date(); d.setDate(d.getDate() + offset); return String(d.getFullYear()) + ('0' + (d.getMonth() + 1)).slice(-2) + ('0' + d.getDate()).slice(-2); }
  function gameTime(game) { var date = new Date(game.date); return isNaN(date.getTime()) ? 'Time to be announced' : date.toLocaleDateString() + ' · ' + date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
  function sportsFilters() {
    var f = state.sportsFilters, choices = [['all','All leagues'],['nfl','NFL'],['nba','NBA'],['wnba','WNBA'],['mlb','MLB'],['nhl','NHL'],['mls','MLS']];
    function buttons(list, field) { return list.map(function (c) { return '<button class="button' + (f[field] === c[0] ? ' selected' : ' subtle') + '" data-action="sports-filter" data-field="' + field + '" data-value="' + c[0] + '" data-focus="sports-' + field + '-' + c[0] + '" aria-pressed="' + (f[field] === c[0]) + '">' + c[1] + '</button>'; }).join(''); }
    return '<div class="sports-filters"><div class="filter-line" role="group" aria-label="League">' + buttons(choices,'league') + '</div><div class="filter-line" role="group" aria-label="Schedule date">' + buttons([['schedule','League schedule'],[sportsDay(-1),'Yesterday'],[sportsDay(0),'Today'],[sportsDay(1),'Tomorrow']],'date') + '<button class="button subtle" data-action="sports-date-prev" data-focus="sports-date-prev">&#8592; Previous day</button><button class="button subtle" data-action="sports-date-next" data-focus="sports-date-next">Next day &#8594;</button></div><div class="filter-line" role="group" aria-label="Game status">' + buttons([['all','All games'],['in','Live now'],['pre','Upcoming'],['post','Finished']],'status') + '</div></div><form id="sports-form" class="search-form"><div class="input-wrap"><label class="sr-only" for="sports-search">Filter by team or matchup</label><input id="sports-search" type="search" placeholder="Find a team or matchup…" value="' + escapeHtml(f.q) + '"></div><button class="button primary" type="submit" data-focus="sports-search-submit">Filter games</button><button class="button subtle" type="button" data-action="sports-reset">Reset</button></form>';
  }
  function gameCards(games, rail, name) {
    return '<div class="cards library-cards game-cards' + (rail ? ' card-rail' : '') + '" id="games-' + name + '">' + games.map(function (game) { state.games[game.id] = game; return '<button class="card game-card" data-action="open-game" data-id="' + game.id + '" data-focus="game-' + name + '-' + game.id + '"><span class="game-status' + (game.status === 'in' ? ' is-live' : '') + '">' + escapeHtml(game.leagueName + ' · ' + (/POSTPONED|CANCELED|CANCELLED|DELAYED|SUSPENDED/.test(game.statusName || '') ? game.statusText : game.status === 'in' ? 'LIVE' : game.status === 'post' ? 'FINAL' : 'UPCOMING')) + '</span><span class="game-matchup">' + escapeHtml(game.title) + '</span><span class="card-subtitle">' + escapeHtml(gameTime(game)) + '</span><span class="game-detail">' + escapeHtml(game.statusText) + '</span><span class="game-availability">Select to check live sources</span></button>'; }).join('') + '</div>';
  }
  function drawSportsRows(data, restore) {
    var f = state.sportsFilters, html = '<p class="catalog-note">' + (f.date === 'schedule' ? 'Latest schedule for each league' : 'Schedule date: ' + f.date.slice(0,4) + '-' + f.date.slice(4,6) + '-' + f.date.slice(6,8)) + '</p>', count = 0; state.games = {};
    var rows = data.rows || [];
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i], games = row.games.filter(function (game) { return (f.status === 'all' || game.status === f.status) && game.title.toLowerCase().indexOf(f.q.toLowerCase()) >= 0; });
      if (games.length || row.error || f.league === row.id) { count += games.length; html += '<section class="discover-section"><div class="section-heading"><h2>' + escapeHtml(row.name) + ' <small>' + games.length + (games.length === 1 ? ' game' : ' games') + '</small></h2>' + (games.length ? '<button class="button subtle" data-action="sports-all" data-league="' + row.id + '" data-focus="sports-all-' + row.id + '">View all &#8594;</button>' : '') + '</div>' + (row.error ? empty('Schedule unavailable', row.error, 'sports-retry', 'Try again', true) : games.length ? gameCards(games, true, row.id) : empty('No games in this view', 'Try League schedule or another date or status.')) + (row.stale ? '<p class="catalog-note">Last saved schedule. Scores and start times may have changed.</p>' : '') + '</section>'; }
    }
    if (!count && f.league === 'all' && !rows.some(function (r) { return !!r.error; })) { html += empty('No games match these filters', 'Try another date, league or status.', 'sports-reset', 'Reset filters'); }
    html += '<p class="catalog-note">' + escapeHtml(data.description || '') + ' Schedules refresh every minute while this page is open.</p>';
    byId('sports-games').innerHTML = html;
    if (restore) { restoreFocus(restore); }
  }
  function renderSports(restore) {
    setView('sports'); state.library = { section: 'sports', page: 1, q: '' };
    state.sportsFilters = restore && restore.sports ? restore.sports : state.sportsFilters || { league: 'all', date: 'schedule', status: 'all', q: '' };
    var request = state.requestId;
    main.innerHTML = heading('Sports', 'Choose a league. Find your game.') + sportsFilters() + '<div id="sports-games">' + loading('Loading game schedules…') + '</div><section id="sports-channels"></section>';
    byId('sports-form').onsubmit = function (event) { event.preventDefault(); changeSportsFilter('q', byId('sports-search').value); };
    state.refreshSports = function (background) { api('/api/sports', { league: state.sportsFilters.league, date: state.sportsFilters.date }, function (error, data) {
      if (request !== state.requestId) { return; }
      if (error) { if (!background) { byId('sports-games').innerHTML = empty('Game schedules could not load', messageFrom(error), 'sports-retry', 'Try again', true); } return; }
      var snapshot = background ? rememberView() : restore; state.sportsData = data; drawSportsRows(data, snapshot);
    }, 25000); };
    state.refreshSports(false);
    api('/api/library', { section: 'sports' }, function (error, data) {
      if (request !== state.requestId || error) { return; }
      state.mediaLists = state.mediaLists || {}; state.mediaLists.sportsChannels = data.results;
      byId('sports-channels').innerHTML = '<div class="section-heading"><h2>Live sports channels</h2></div><p class="catalog-note">Watch each channel’s current programming. These channels are separate from the game listings above.</p>' + libraryCards(data.results, 'sportsChannels', true);
    });
    if (restore) { restoreFocus(restore); } else { focusFirst('[data-focus="sports-league-' + state.sportsFilters.league + '"]'); }
  }
  function changeSportsFilter(field, value) {
    var old = state.sportsFilters, next = { league: old.league, date: old.date, status: old.status, q: old.q }; next[field] = value;
    state.sportsFilters = next; var snapshot = rememberView(); snapshot.sports = next;
    renderSports(snapshot);
  }
  function openGame(id, returning) {
    var game = state.games[id]; if (!game) { return; }
    if (!returning) { state.gameReturn = rememberView(); }
    state.game = game; setView('game-detail'); var request = state.requestId;
    main.innerHTML = '<button class="back-button" data-action="close-game">&#8592; Back to games</button>' + heading(game.title, game.leagueName + ' · ' + gameTime(game)) + '<div class="game-info"><p class="eyebrow">' + escapeHtml(game.statusText) + '</p><p>' + escapeHtml(game.broadcasts.length ? game.broadcasts.join(' · ') : 'Broadcaster not yet listed') + '</p><p>' + escapeHtml(game.venue) + '</p></div><section><h2>Watch this game</h2><div id="game-sources">' + loading('Finding live sources for this matchup…') + '</div></section>';
    focusFirst('[data-action="close-game"]');
    api('/api/sports/sources', { id: game.id, date: state.sportsFilters.date }, function (error, data) {
      if (request !== state.requestId) { return; }
      var html;
      if (error) { html = empty('Sources could not load', messageFrom(error), 'game-retry', 'Check again', true); }
      else {
        state.gameSources = data.sources || [];
        html = '<p class="media-description">' + escapeHtml(data.message) + '</p>';
        if (state.gameSources.length) {
          html += '<div class="filter-line"><button class="button primary" data-action="watch-game" data-source="auto" data-focus="watch-game-auto">Play best available &#9654;</button></div><div class="filter-line" role="group" aria-label="Game video sources">';
          for (var i = 0; i < state.gameSources.length; i++) { html += '<button class="button" data-action="watch-game" data-source="' + escapeHtml(state.gameSources[i].id) + '" data-focus="watch-game-' + i + '">' + escapeHtml(state.gameSources[i].name) + ' &#9654;</button>'; }
          html += '</div><p class="catalog-note">If playback fails, AniHarbor tries another available source. Use Try another source to change it yourself.</p>';
        }
        html += '<button class="button subtle" data-action="game-retry">Check again</button>';
      }
      byId('game-sources').innerHTML = html;
      if (document.activeElement === document.body || (document.activeElement && document.activeElement.getAttribute('data-action') === 'close-game')) { focusFirst('[data-action="watch-game"], [data-action="game-retry"]'); }
    }, 45000);
  }
  function startGame(source) {
    if (!state.game) { return; }
    var game = state.game;
    state.mediaParts = [];
    startMedia({ id: game.id, title: game.title, kind: 'live', provider: 'Live sports', sportsGame: true, source: source || 'auto', date: state.sportsFilters.date }, true);
  }
  function sportsCollection(league, page, restore) {
    var row = (state.sportsData.rows || []).filter(function (r) { return r.id === league; })[0]; if (!row) { return; }
    if (state.view === 'sports') { state.sportsCollectionReturn = rememberView(); }
    setView('sports-collection'); state.sportsCollection = { league: league, page: page || 1 }; var f = state.sportsFilters;
    var games = row.games.filter(function (g) { return (f.status === 'all' || f.status === g.status) && g.title.toLowerCase().indexOf(f.q.toLowerCase()) >= 0; }), start = (state.sportsCollection.page - 1) * 24;
    main.innerHTML = '<button class="back-button" data-action="close-sports-collection">&#8592; Back to sports</button>' + heading(row.name + ' games', games.length + ' matchups with your current filters') + gameCards(games.slice(start,start + 24), false, 'collection') + '<div class="pagination"><button class="button" data-action="sports-page-prev"' + (!start ? ' disabled' : '') + '>Previous page</button><span>Page ' + state.sportsCollection.page + '</span><button class="button" data-action="sports-page-next"' + (start + 24 >= games.length ? ' disabled' : '') + '>Next page</button></div>';
    if (restore) { restoreFocus(restore); } else { focusFirst(main.querySelector('.card') ? '#main .card' : '#main .back-button'); }
  }
  function renderLibrary(section, page, q, restore) {
    if (section === 'sports') { renderSports(restore); return; }
    if (!section || section === 'home' || section === 'continue' || section === 'recommended') { renderMediaHome(section || 'home', restore); return; }
    section = section || 'channels'; state.library = { section: section, page: page || 1, q: q || '', results: [] }; setView(section === 'sports' ? 'sports' : 'media');
    var request = state.requestId, title = section === 'sports' ? 'Live sports' : 'TV & Movies', tabs = '', choices = [['channels', 'Live channels'], ['movies', 'Movies on demand'], ['tv', 'TV on demand']], i;
    if (section !== 'sports') { for (i = 0; i < choices.length; i++) { tabs += '<button class="button' + (section === choices[i][0] ? ' selected' : ' subtle') + '" data-action="library-section" data-section="' + choices[i][0] + '" data-focus="library-' + choices[i][0] + '" aria-pressed="' + (section === choices[i][0]) + '">' + choices[i][1] + '</button>'; } }
    main.innerHTML = heading(title, section === 'sports' ? 'Pick a channel and settle into the action.' : 'Live channels and a library of on-demand classics.') + mediaTabs(section) + '<form id="library-form" class="search-form"><div class="input-wrap"><label class="sr-only" for="library-search">Search ' + escapeHtml(title) + '</label><input id="library-search" type="search" placeholder="Search ' + (section === 'sports' || section === 'channels' ? 'channels' : 'classic titles') + '…" value="' + escapeHtml(state.library.q) + '"></div><button type="submit" class="button primary">Search</button></form><div id="library-results">' + loading('Loading your library…') + '</div>';
    byId('library-form').onsubmit = function (event) { event.preventDefault(); renderLibrary(state.library.section, 1, byId('library-search').value); };
    api('/api/library', { section: section, page: state.library.page, q: state.library.q }, function (error, data) {
      if (request !== state.requestId) { return; }
      if (error) { byId('library-results').innerHTML = empty('This collection could not load', messageFrom(error), 'library-retry', 'Try again', true); focusFirst('#library-results button'); return; }
      state.library.results = data.results || [];
      byId('library-results').innerHTML = '<p class="catalog-note">' + escapeHtml(data.description) + '</p>' + (data.results.length ? libraryCards(data.results) : empty('No matches found', 'Try a shorter title or another collection.')) + '<div class="pagination"><button class="button subtle" data-action="library-prev" data-focus="library-prev"' + (state.library.page < 2 ? ' disabled' : '') + '>&#8592; Previous page</button><span>Page ' + state.library.page + '</span><button class="button subtle" data-action="library-next" data-focus="library-next"' + (!data.hasNextPage ? ' disabled' : '') + '>Next page &#8594;</button></div>';
      if (restore) { restoreFocus(restore); } else { focusFirst(data.results.length ? '#library-results .card' : '#library-search'); }
    }, 60000);
  }
  function openMedia(item, resume) {
    if (!item) { return; } state.mediaReturn = rememberView(); state.mediaItem = item; state.mediaParts = []; state.mediaPage = 0; setView('media-detail');
    main.innerHTML = '<button class="back-button" data-action="close-media-detail">&#8592; Back to library</button>' + heading(item.title, [item.kind === 'live' ? 'Live channel' : 'On demand', item.provider, item.year || item.country || ''].join(' · ')) + '<p class="media-description">' + escapeHtml(item.description || 'Select Watch to check the available video sources and start playback.') + '</p><button class="button primary" data-action="watch-media" data-focus="watch-media">' + (item.kind === 'live' ? 'Watch live' : 'Watch now') + ' &#9654;</button>';
    if (item.kind === 'live') { focusFirst('[data-action="watch-media"]'); return; }
    var request = state.requestId; byId('main').querySelector('[data-action="watch-media"]').disabled = true;
    main.innerHTML += '<div id="media-parts">' + loading('Finding available videos…') + '</div>';
    api('/api/library/item', { id: item.id }, function (error, data) {
      if (request !== state.requestId) { return; }
      if (error) { byId('media-parts').innerHTML = empty('Videos could not load', messageFrom(error), 'reload-media', 'Try again', true); focusFirst('#media-parts button'); return; }
      state.mediaParts = data.episodes || []; if (data.item) { state.mediaItem = data.item; } var watch = main.querySelector('[data-action="watch-media"]');
      watch.disabled = !state.mediaParts.length; toggleClass(watch, 'hidden', state.mediaParts.length > 1);
      drawMediaParts();
      if (resume && resume.part) { for (var i = 0; i < state.mediaParts.length; i++) { if (state.mediaParts[i].id === resume.part.id) { startMedia(state.mediaItem, false, state.mediaParts[i]); return; } } toast('The saved video is no longer listed. Choose another video below.'); }
      focusFirst(state.mediaParts.length > 1 ? '#media-parts .episode' : '[data-action="watch-media"]');
    }, 60000);
  }
  function drawMediaParts() {
    var html = '', i, start = state.mediaPage * 24, end = Math.min(start + 24, state.mediaParts.length);
    if (state.mediaParts.length > 1) { html = '<h2>Choose an episode or video</h2><div class="episode-grid">'; for (i = start; i < end; i++) { html += '<button class="episode" data-action="watch-media-part" data-index="' + i + '" data-focus="part-' + i + '"><span class="episode-number">' + (i + 1) + '</span><span class="episode-text"><span class="episode-label">' + escapeHtml(state.mediaParts[i].title) + '</span><span class="episode-detail">Play video</span></span></button>'; } html += '</div><div class="pagination"><button class="button" data-action="media-parts-prev"' + (!start ? ' disabled' : '') + '>Previous videos</button><span>Page ' + (state.mediaPage + 1) + '</span><button class="button" data-action="media-parts-next"' + (end >= state.mediaParts.length ? ' disabled' : '') + '>Next videos</button></div>'; }
    byId('media-parts').innerHTML = html || (state.mediaParts.length ? '<p class="catalog-note">Ready to watch. Your place will be saved on this device.</p>' : empty('No compatible videos', 'This archive item has no compatible MP4 files.'));
  }
  function startMedia(item, replay, part) {
    if (state.player) { saveProgress(); stopEngine(); }
    part = part || (state.mediaParts || [])[0];
    var history = mediaProgress[item.id + ':' + (part ? part.id : '')];
    state.player = { libraryItem: item, libraryPart: part, live: item.kind === 'live', series: item, show: item, episode: {id:item.id, number:1}, language:'', provider:item.provider, excluded:[], sources:[], sourceIndex:-1, position: !replay && item.kind !== 'live' && history && !history.complete ? history.position : 0, duration:0, paused:false, started:false, subtitleIndex:-1, recovering:false, failures:0, complete:false };
    lastSave = 0; playerElement.className = 'player controls-visible' + (av ? ' tv-playback' : ''); toggleClass(document.body, 'tv-active', !!av); toggleClass(document.documentElement, 'tv-active', !!av); byId('app').setAttribute('aria-hidden', 'true');
    setText('player-title', item.title); setText('player-episode', item.sportsGame ? 'LIVE GAME' : state.player.live ? 'LIVE CHANNEL' : part && state.mediaParts.length > 1 ? part.title : 'ON DEMAND'); setText('player-provider', item.provider); setText('player-status', ''); setText('player-time', state.player.live ? 'LIVE' : clock(state.player.position)); setText('toggle-play', 'Pause'); byId('next-episode').disabled = !findNextEpisode(); setPlayerControls(); showPlayerMessage('Checking video availability…'); focusFirst('#toggle-play'); resolveEpisode();
  }
  function setPlayerControls() { var live = state.player && state.player.live, controls = document.querySelectorAll('[data-action="rewind"], [data-action="forward"]'), i; for (i = 0; i < controls.length; i++) { controls[i].disabled = !!live; } setText('player-back', state.player && state.player.libraryItem && state.player.libraryItem.sportsGame ? '← Back to game' : state.player && state.player.libraryItem ? '← Back to library' : '← Back to episodes'); }
  function restoreFocus(snapshot) {
    if (!snapshot) { return; } var elements = document.querySelectorAll('[data-focus]'), target = byId(snapshot.focus), i, key;
    for (i = 0; i < elements.length; i++) { if (elements[i].getAttribute('data-focus') === snapshot.focus) { target = elements[i]; break; } }
    if (target) { target.focus(); } for (key in snapshot.rails) { if (byId(key)) { byId(key).scrollLeft = snapshot.rails[key]; } } window.scrollTo(0, snapshot.scroll);
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
        html += '<section class="source-card' + (state.provider === source.id ? ' active-source' : '') + '"><div class="source-card-heading"><span class="source-letter">' + escapeHtml(source.name.substring(0, 1)) + '</span><h2>' + escapeHtml(source.name) + '</h2></div><span class="status-pill' + (/error|down|unavailable|disabled|cooldown/.test(status) ? ' unavailable' : '') + '">' + escapeHtml(status) + '</span><p>' + escapeHtml(source.error || source.note || 'Search this provider directly or include it when searching all sources.') + '</p><div class="source-family">Family: ' + escapeHtml(source.family || source.id) + ' · ' + escapeHtml((source.languages || ['sub']).join(' / ')) + '</div><button class="button subtle" data-action="select-provider" data-index="' + i + '"' + (source.disabled ? ' disabled' : '') + '>Search ' + escapeHtml(source.name) + ' &#8594;</button></section>';
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
      if (state.providers.length) { resolved = JSON.parse(JSON.stringify(resolved)); resolved.seasons = resolved.seasons.map(function (season) { season.providers = season.providers.filter(function (selection) { var p; for (p = 0; p < state.providers.length; p++) { if (state.providers[p].id === selection.provider) { return !state.providers[p].disabled; } } return true; }); return season; }).filter(function (season) { return season.providers.length; }); }
      if (!resolved.seasons.length) { state.query = show.title; renderSearch(true); return; }
      if (state.view !== 'detail' || request !== state.requestId) { return; }
      state.show = resolved; var i, j, season, match = history && history.series;
      if (match) { for (i = 0; i < resolved.seasons.length; i++) { season = resolved.seasons[i]; for (j = 0; j < season.providers.length; j++) { if (seriesKey(season.providers[j]) === seriesKey(match)) { state.seasonIndex = i; state.providerIndex = j; } } } state.language = history.language || 'sub'; }
      selectDetailSource(true); focusFirst('#save-series');
    }
    if (show.seasons && show.seasons.length) {
      ready(show);
      if (!show.expanded || !show.refreshedAt || Date.now() - show.refreshedAt > DISCOVER_TTL) {
        api('/api/show', { title: show.title, malId: show.malId || '', lookupTitles: JSON.stringify(show.lookupTitles || []) }, function (error, data) {
          if (error || !data.show || !data.show.seasons || !data.show.seasons.length || state.view !== 'detail' || state.player || detailId !== state.detailId) { return; }
          var selected = seriesKey(state.series), i, j, nextSeason = -1, nextProvider = 0, focused = document.activeElement, actionName = focused && focused.getAttribute('data-action'), focusedIndex = focused && focused.getAttribute('data-index'), scroll = window.pageYOffset, target;
          for (i = 0; i < data.show.seasons.length; i++) { for (j = 0; j < data.show.seasons[i].providers.length; j++) { if (seriesKey(data.show.seasons[i].providers[j]) === selected) { nextSeason = i; nextProvider = j; } } }
          if (nextSeason < 0) { return; }
          data.show.refreshedAt = Date.now(); state.show = data.show; state.seasonIndex = nextSeason; state.providerIndex = nextProvider; state.series = currentSeason().providers[nextProvider];
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
      state.episodeAvailability = data.availability; state.episodes = data.episodes || []; var history = selectedHistory(), match = resumeEpisode(history), i, count = 0;
      if (initial && match) { for (i = 0; i < state.episodes.length; i++) { if (state.episodes[i].languages && state.episodes[i].languages.length && state.episodes[i].languages.indexOf(state.language) < 0) { continue; } if (state.episodes[i] === match) { state.episodePage = Math.floor(count / 24); break; } count++; } }
      drawEpisodes(); updateResume();
    }, 90000);
  }
  function drawDetail(pending) {
    var show = state.show, season = currentSeason(), i, html = '', isSaved = isSavedShow(show), detailYear, summary, facts;
    if (!season || !state.series) { return; }
    if (show.kind !== 'movie') { html += '<div class="detail-picker"><h2>Season</h2><div class="picker-options" aria-label="Seasons">'; for (i = 0; i < show.seasons.length; i++) { html += '<button class="button small' + (i === state.seasonIndex ? ' selected' : '') + '" data-action="select-season" data-index="' + i + '" aria-pressed="' + (i === state.seasonIndex) + '">' + escapeHtml(show.seasons[i].label || show.seasons[i].title || 'Season ' + (i + 1)) + '</button>'; } html += '</div></div>'; }
    html += '<div class="detail-picker"><h2>Provider</h2><div class="picker-options" aria-label="Providers">';
    for (i = 0; i < season.providers.length; i++) { html += '<button class="button small' + (i === state.providerIndex ? ' selected' : '') + '" data-action="detail-provider" data-index="' + i + '" aria-pressed="' + (i === state.providerIndex) + '">' + escapeHtml(providerName(season.providers[i].provider)) + '</button>'; }
    html += '</div></div>';
    detailYear = season.year || show.year || (season.releaseDate ? String(season.releaseDate).slice(0, 4) : '');
    summary = season.description || show.description || (show.kind === 'movie' ? 'Choose a provider, then select the movie below. Your place is remembered on this device.' : 'Choose a season and provider, then select an episode. Your place is remembered on this device.');
    facts = detailFacts(show, season);
    main.innerHTML = '<section class="detail"><button class="back-button" data-action="back">&#8592; Back to ' + escapeHtml(state.lastView === 'search' ? 'results' : state.lastView === 'saved' ? 'my list' : 'discover') + '</button><div class="detail-header">' + posterTag(show, 'detail-cover', false) + '<div class="detail-info"><p class="eyebrow">' + escapeHtml(show.kind === 'movie' ? 'MOVIE' : 'SERIES') + (detailYear ? ' / ' + escapeHtml(detailYear) : '') + '</p><h1>' + escapeHtml(show.title) + '</h1>' + facts + '<p class="detail-description">' + escapeHtml(summary) + '</p><button id="save-series" class="button ' + (isSaved ? 'subtle' : 'primary') + '" data-action="save-series">' + (isSaved ? '&#10003; In my list' : '+ Add to my list') + '</button><button id="resume-series" class="button subtle hidden" data-action="resume"></button></div></div><div class="detail-selectors">' + html + '</div><div class="detail-tools"><h2>' + (show.kind === 'movie' ? 'Watch movie' : 'Episodes') + '</h2><div class="language-switch"><button class="button small' + (state.language === 'sub' ? ' selected' : '') + '" data-action="language" data-language="sub" aria-pressed="' + (state.language === 'sub') + '">SUB</button><button class="button small' + (state.language === 'dub' ? ' selected' : '') + '" data-action="language" data-language="dub" aria-pressed="' + (state.language === 'dub') + '">DUB</button></div></div><div id="episodes-content">' + (pending ? loading('Loading episodes from ' + providerName(state.series.provider) + '…') : '') + '</div></section>';
    if (!pending) { drawEpisodes(); updateResume(); }
  }
  function updateResume() { var history = selectedHistory(), episode = resumeEpisode(history), button = byId('resume-series'); if (!button) { return; } toggleClass(button, 'hidden', !episode || history.completed); if (episode && !history.completed) { button.textContent = 'Resume episode ' + history.episode.number + ' · ' + clock(history.position); } }
  function drawEpisodes() {
    var html = (state.episodeAvailability === 'unverified' ? '<p class="feed-note">This episode list comes from catalog information. Video and audio availability will be checked when you select an episode.</p>' : '') + '<div class="episode-grid">', i, episode, eligible = [], history = selectedHistory(), isCurrent, start, end, pages;
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
    if (!state.player && state.view === 'game-detail') { restoreView(state.gameReturn); return; }
    if (!state.player && state.view === 'sports-collection') { restoreView(state.sportsCollectionReturn); return; }
    if (!state.player && state.view === 'media' && state.library.section !== 'home') { renderMediaHome('home'); return; }
    if (!state.player && state.view === 'media-detail') { restoreView(state.mediaReturn); return; }
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
    setPlayerControls(); showPlayerMessage('Finding an episode stream…'); focusFirst('#toggle-play'); resolveEpisode();
  }
  function showPlayerMessage(text, error) { hide('player-loading', false); toggleClass(byId('player-loading'), 'error', !!error); setText('player-message', text); setText('player-attempts', ''); }
  function showSourceAttempts(data) {
    var attempts = data && data.attempts, lines = [], i, name, message;
    if (!attempts || !attempts.length) { return; }
    for (i = 0; i < attempts.length && i < 4; i++) { name = providerName(attempts[i].provider); message = String(attempts[i].message || 'Unavailable.'); if (message.indexOf(name + ' ') === 0) { message = message.slice(name.length + 1); } lines.push(name + ': ' + message.slice(0, 180)); }
    setText('player-attempts', lines.join('\n'));
  }
  function screenSaver(enabled) { try { if (window.webapis && window.webapis.appcommon) { window.webapis.appcommon.setScreenSaver(enabled ? window.webapis.appcommon.AppCommonScreenSaverState.SCREEN_SAVER_ON : window.webapis.appcommon.AppCommonScreenSaverState.SCREEN_SAVER_OFF, function () {}, function () {}); } } catch (e) {} }
  function resolveEpisode() {
    var playback = state.player;
    if (!playback) { return; }
    var generation = ++playbackGeneration;
    playback.recovering = true;
    api(playback.libraryItem && playback.libraryItem.sportsGame ? '/api/sports/resolve' : playback.libraryItem ? '/api/library/resolve' : '/api/resolve', playback.libraryItem && playback.libraryItem.sportsGame ? { id: playback.libraryItem.id, date: playback.libraryItem.date, source: playback.excluded.length ? 'auto' : playback.libraryItem.source, exclude: playback.excluded.join(',') } : playback.libraryItem ? { id: playback.libraryItem.id, file: playback.libraryPart && playback.libraryPart.id } : { provider: playback.series.provider, id: playback.series.id, episodeId: playback.episode.id, title: playback.series.title, lookupTitles: JSON.stringify(playback.series.lookupTitles || playback.series.aliases || []), number: playback.episode.number, year: playback.series.year || '', language: playback.language, exclude: playback.excluded.join(',') }, function (error, data) {
      if (!state.player || generation !== playbackGeneration) { return; }
      playback.recovering = false;
      if (error || !data.sources || !data.sources.length) { if (playback.libraryItem && playback.libraryItem.sportsGame && playback.libraryItem.source !== 'auto' && !playback.excluded.length) { playback.excluded.push(playback.libraryItem.source); resolveEpisode(); return; } playbackFailed(error ? messageFrom(error) : 'No playable stream was returned. Try another episode, language, or source.'); showSourceAttempts(data); return; }
      playback.sourceId = data.sourceId; playback.provider = data.provider || playback.series.provider; playback.sources = data.sources; playback.sourceIndex = -1;
      setText('player-provider', providerName(playback.provider));
      setText('player-status', playback.excluded.length ? 'Switched to ' + providerName(playback.provider) + (playback.live ? '.' : '. Your place is preserved.') : 'Playing from ' + providerName(playback.provider));
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
        var position = state.player.live ? 0 : state.player.position;
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
      if (!state.player.live && state.player.position > 0) { try { video.currentTime = state.player.position; } catch (e) {} }
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
        hls.on(window.Hls.Events.ERROR, function (event, data) { if (data.fatal && generation === playbackGeneration && state.player) { streamError('The HLS stream could not be loaded (' + (data.details || data.type || 'unknown error') + (data.error && data.error.message ? ': ' + data.error.message.replace(/https?:\/\/\S+/g, '[video link]') : '') + ').'); } });
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
    if (playback.libraryItem && playback.libraryItem.sportsGame) {
      if (playback.sourceId && playback.excluded.indexOf(playback.sourceId) < 0) { playback.excluded.push(playback.sourceId); }
      stopEngine(); playback.position = 0;
      showPlayerMessage('Checking another game source…'); showControls(); resolveEpisode(); return;
    }
    if (playback.libraryItem) { if (manual && playback.sourceIndex + 1 < playback.sources.length) { tryNextStream(); return; } playbackFailed('No more streams are available for this item. Retry or choose another item.'); return; }
    if (playback.excluded.indexOf(playback.provider) < 0) { playback.excluded.push(playback.provider); }
    stopEngine();
    if (playback.excluded.length >= Math.max(state.providers.length, 1) || playback.excluded.length >= 12) { playbackFailed('No more sources are available for this episode. Try another language or search for the series on a different source.'); return; }
    showPlayerMessage(manual ? 'Looking for another source…' : 'This source could not play. Trying a backup…'); showControls(); resolveEpisode();
  }
  function playbackFailed(reason) { stopEngine(); if (!state.player) { return; } state.player.paused = true; state.player.recovering = false; state.player.started = false; showPlayerMessage(reason, true); setText('player-status', state.player.libraryItem && state.player.libraryItem.sportsGame ? 'Use Back to return to the game and source choices.' : 'Use Back to return to the episode list.'); setText('toggle-play', 'Retry'); showControls(); focusFirst('#toggle-play'); }
  function updateTime(position, duration) {
    if (!state.player) { return; }
    state.player.position = position; state.player.duration = duration || state.player.duration;
    renderSubtitle(position);
    setText('player-time', state.player.live ? 'LIVE' : clock(position) + ' / ' + clock(state.player.duration));
    byId('progress-fill').style.width = (state.player.duration ? Math.min(100, position / state.player.duration * 100) : 0) + '%';
    if (Date.now() - lastSave > 5000) { saveProgress(); }
  }
  function saveProgress() { if (!state.player) { return; } var playback = state.player; if (playback.libraryItem) { if (!playback.live && playback.position > 0) { mediaProgress[playback.libraryItem.id + ':' + (playback.libraryPart ? playback.libraryPart.id : '')] = { item: playback.libraryItem, part: playback.libraryPart, position: playback.position, duration: playback.duration, complete: playback.complete, updated: Date.now() }; var historyKeys = MediaHistory.entries(mediaProgress); for (var hi = 200; hi < historyKeys.length; hi++) { delete mediaProgress[historyKeys[hi].key]; } writeStore('media-progress', mediaProgress); } lastSave = Date.now(); return; } if (playback.position < 1 && !playback.complete) { return; } var seasons = playback.show.seasons || [], i, j, legacyKey; for (i = 0; i < seasons.length; i++) { if (seasons[i].id === playback.seasonId) { for (j = 0; j < seasons[i].providers.length; j++) { legacyKey = seriesKey(seasons[i].providers[j]); if (progress[legacyKey]) { delete progress[legacyKey]; } } } } progress[showKey(playback.show) + ':season:' + playback.seasonId] = { show: playback.show, seasonId: playback.seasonId, series: playback.series, episode: playback.episode, language: playback.language, position: playback.position, duration: playback.duration, completed: playback.complete, updated: Date.now() }; writeStore('progress', progress); lastSave = Date.now(); }
  function completeEpisode() { if (!state.player) { return; } state.player.complete = true; state.player.paused = true; saveProgress(); screenSaver(true); hide('player-loading', true); setText('toggle-play', 'Replay'); setText('player-status', findNextEpisode() ? 'Episode complete. Ready for the next one?' : 'Episode complete.'); showControls(); if (findNextEpisode()) { focusFirst('#next-episode'); } else { focusFirst('#toggle-play'); } }
  function togglePlay() {
    var playback = state.player;
    if (!playback || playback.recovering) { return; }
    if (playback.complete) { if (playback.libraryItem) { startMedia(playback.libraryItem, true, playback.libraryPart); } else { startEpisode(playback.episode, 0); } return; }
    if (!playback.started && hasClass(byId('player-loading'), 'error')) { playback.excluded = []; playback.failures = 0; showPlayerMessage('Trying the episode again…'); resolveEpisode(); return; }
    try {
      if (playback.paused) { if (av) { av.play(); } else { playBrowserVideo(playbackGeneration); } playback.paused = false; }
      else { if (av) { av.pause(); } else { video.pause(); } playback.paused = true; saveProgress(); }
      screenSaver(playback.paused); setText('toggle-play', playback.paused ? 'Play' : 'Pause'); showControls();
    } catch (e) { toast('Playback is not ready yet.'); }
  }
  function seek(delta) {
    if (!state.player || state.player.live || !state.player.started || !state.player.duration) { return; }
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
  function findNextEpisode() { if (!state.player) { return null; } if (state.player.libraryItem) { var partIndex = state.mediaParts.indexOf(state.player.libraryPart); return partIndex >= 0 ? state.mediaParts[partIndex + 1] : null; } var i, found = false; for (i = 0; i < state.episodes.length; i++) { if (found && (!state.episodes[i].languages || !state.episodes[i].languages || !state.episodes[i].languages.length || state.episodes[i].languages.indexOf(state.player.language) >= 0)) { return state.episodes[i]; } if (String(state.episodes[i].id) === String(state.player.episode.id)) { found = true; } } return null; }
  function showControls() { if (!state.player) { return; } clearTimeout(controlsTimer); toggleClass(playerElement, 'controls-hidden', false); toggleClass(playerElement, 'controls-visible', true); controlsTimer = setTimeout(function () { if (state.player && state.player.started && !state.player.paused && !state.player.complete && hasClass(byId('player-loading'), 'hidden')) { toggleClass(playerElement, 'controls-hidden', true); toggleClass(playerElement, 'controls-visible', false); } }, 6000); }
  function closePlayer() {
    if (!state.player) { return; }
    var libraryItem = state.player.libraryItem, libraryPart = state.player.libraryPart;
    var episode = state.player.episode, i, count = 0, index = -1;
    saveProgress(); stopEngine(); clearTimeout(controlsTimer); state.player = null; hide('player', true); toggleClass(document.body, 'tv-active', false); toggleClass(document.documentElement, 'tv-active', false); byId('app').removeAttribute('aria-hidden');
    if (libraryItem && libraryItem.sportsGame) { openGame(libraryItem.id, true); return; }
    if (libraryItem) { setView('media-detail'); var partIndex = state.mediaParts.indexOf(libraryPart); if (partIndex >= 0 && state.mediaParts.length > 1) { state.mediaPage = Math.floor(partIndex / 24); drawMediaParts(); focusFirst('[data-action="watch-media-part"][data-index="' + partIndex + '"]'); } else { focusFirst('[data-action="watch-media"]'); } return; }
    for (i = 0; i < state.episodes.length; i++) { if (state.episodes[i].languages && state.episodes[i].languages.length && state.episodes[i].languages.indexOf(state.language) < 0) { continue; } if (String(state.episodes[i].id) === String(episode.id)) { state.episodePage = Math.floor(count / 24); index = i; break; } count++; }
    drawDetail(false); focusFirst(index >= 0 ? '[data-action="play-episode"][data-index="' + index + '"]' : '#main .episode');
  }
  function action(name, element) {
    var index = element ? parseInt(element.getAttribute('data-index'), 10) : -1, list, history, section, episode;
    if (name === 'home' || name === 'search' || name === 'saved' || name === 'sources' || name === 'settings') { state.trail = []; }
    if (name === 'home') { renderHome(); }
    else if (name === 'search') { var previousProvider = state.provider; state.provider = 'auto'; renderSearch(previousProvider !== 'auto' && !!state.query); }
    else if (name === 'sports' || name === 'media') { state.trail = []; renderLibrary(name === 'sports' ? 'sports' : 'home', 1, ''); }
    else if (name === 'library-section') { renderLibrary(element.getAttribute('data-section'), 1, ''); }
    else if (name === 'library-prev' || name === 'library-next' || name === 'library-retry') { renderLibrary(state.library.section, state.library.page + (name === 'library-prev' ? -1 : name === 'library-next' ? 1 : 0), state.library.q); }
    else if (name === 'open-media') { list = element.getAttribute('data-list') || 'browse'; var media = list === 'browse' ? state.library.results[index] : state.mediaLists[list][index]; openMedia(media, media.resume); }
    else if (name === 'media-collection') { state.mediaHomeReturn = rememberView(); drawMediaCollection(element.getAttribute('data-section'), 1); }
    else if (name === 'media-home-back') { renderMediaHome('home', state.mediaHomeReturn); }
    else if (name === 'media-collection-prev' || name === 'media-collection-next') { drawMediaCollection(state.library.section, state.library.page + (name === 'media-collection-next' ? 1 : -1)); }
    else if (name === 'sports-filter') { changeSportsFilter(element.getAttribute('data-field'), element.getAttribute('data-value')); }
    else if (name === 'sports-date-next' || name === 'sports-date-prev') { var dateKey = state.sportsFilters.date === 'schedule' ? sportsDay(0) : state.sportsFilters.date; var nextDay = new Date(Number(dateKey.slice(0,4)), Number(dateKey.slice(4,6)) - 1, Number(dateKey.slice(6,8)) + (name === 'sports-date-next' ? 1 : -1)); changeSportsFilter('date', String(nextDay.getFullYear()) + ('0' + (nextDay.getMonth() + 1)).slice(-2) + ('0' + nextDay.getDate()).slice(-2)); }
    else if (name === 'sports-reset') { state.sportsFilters = { league: 'all', date: 'schedule', status: 'all', q: '' }; renderSports(); }
    else if (name === 'sports-retry') { renderSports(rememberView()); }
    else if (name === 'open-game') { openGame(element.getAttribute('data-id')); }
    else if (name === 'watch-game') { startGame(element.getAttribute('data-source')); }
    else if (name === 'game-retry') { openGame(state.game.id, true); }
    else if (name === 'close-game') { restoreView(state.gameReturn); }
    else if (name === 'sports-all') { sportsCollection(element.getAttribute('data-league'), 1); }
    else if (name === 'close-sports-collection') { restoreView(state.sportsCollectionReturn); }
    else if (name === 'sports-page-next' || name === 'sports-page-prev') { sportsCollection(state.sportsCollection.league, state.sportsCollection.page + (name === 'sports-page-next' ? 1 : -1)); }
    else if (name === 'reload-media') { var original = state.mediaReturn; openMedia(state.mediaItem); state.mediaReturn = original; }
    else if (name === 'watch-media-part') { startMedia(state.mediaItem, false, state.mediaParts[index]); }
    else if (name === 'media-parts-prev' || name === 'media-parts-next') { state.mediaPage += name === 'media-parts-next' ? 1 : -1; drawMediaParts(); focusFirst('#media-parts .episode'); }
    else if (name === 'watch-media') { startMedia(state.mediaItem); }
    else if (name === 'close-media-detail') { restoreView(state.mediaReturn); }
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
    else if (name === 'next-episode') { var next = findNextEpisode(); if (next) { if (state.player.libraryItem) { startMedia(state.player.libraryItem, false, next); } else { startEpisode(next, 0); } } else { toast('No next episode is listed.'); } }
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
  document.addEventListener('error', function (event) { if (event.target.tagName === 'IMG' && event.target.getAttribute('src') !== 'assets/placeholder.svg') { event.target.setAttribute('data-poster-failed', 'true'); event.target.src = 'assets/placeholder.svg'; setTimeout(repairPosters, 50); } }, true);
  if (window.MutationObserver) { new MutationObserver(function () { repairPosters(); }).observe(main, { childList:true, subtree:true }); }
  setInterval(repairPosters, 15000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { repairPosters(); } });
  document.addEventListener('keydown', function (event) {
    var code = event.keyCode || event.which, input = event.target && /INPUT|TEXTAREA/.test(event.target.tagName);
    if (input && window.tizen) {
      if (code === 65376 || code === 65385) { event.target.blur(); if (event.target.id === 'search-input') { if (code === 65376) { performSearch(); } focusFirst('#search-form button[type="submit"]'); } else if (event.target.id === 'sports-search') { if (code === 65376) { changeSportsFilter('q', event.target.value); } else { focusFirst('#sports-form button'); } } else if (event.target.id === 'library-search') { if (code === 65376) { renderLibrary(state.library.section, 1, event.target.value); } else { focusFirst('#library-form button'); } } else if (event.target.id === 'episode-jump') { if (code === 65376) { jumpEpisode(); } else { focusFirst('[data-action="jump-episode"]'); } } else { focusFirst('#settings-form button[type="submit"]'); } return; }
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
  setInterval(function () { if (state.player || document.hidden) { return; } if (state.view === 'home') { loadDiscover('recommended', true); loadDiscover('new', true); } else if (state.view === 'collection' && state.refreshCollection) { state.refreshCollection(); } }, DISCOVER_TTL);
  setInterval(function () { if (!state.player && !document.hidden && state.view === 'sports' && state.refreshSports) { state.refreshSports(true); } }, 60000);
  renderHome();
  refreshProviders(function () { if (state.view === 'home') { var snapshot = rememberView(); restoreView(snapshot); } });
}());
