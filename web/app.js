// Mes Menus - frontend SPA (client + cuisinier UI)
// Mobile-first. Client view: /aujourd'hui (déjeuner / dîner) with rating.
// Cuisinier view: menus list (stats + tri), create menu, assign menus to upcoming 7 days.

(function () {
  const app = document.getElementById('app');

  let currentDate = new Date();
  let sessionUser = null;
  let isAdminView = false;
  let menusCache = []; // cached menus for admin
  let upcomingCache = []; // cached upcoming assignments for admin

  function fmtDate(d) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  function displayDateLabel(d) {
    const opts = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    return d.toLocaleDateString('fr-FR', opts);
  }

  async function fetchJson(url, opts = {}) {
    opts.credentials = 'include';
    opts.headers = Object.assign({ 'Accept': 'application/json' }, opts.headers || {});
    if (opts.body && !(opts.body instanceof FormData)) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(opts.body);
    }
    const res = await fetch(url, opts);
    const text = await res.text().catch(() => '');
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
    if (!res.ok) {
      throw { status: res.status, body: data };
    }
    return data;
  }

  async function getSession() {
    try {
      const me = await fetchJson('/api/me');
      sessionUser = me.user;
    } catch (err) {
      sessionUser = null;
    }
  }

  async function login(username, password) {
    const res = await fetchJson('/api/login', { method: 'POST', body: { username, password } });
    sessionUser = res.user;
    await refreshCaches();
    render();
  }

  async function logout() {
    try {
      await fetchJson('/api/logout', { method: 'POST' });
    } catch (e) {}
    sessionUser = null;
    render();
  }

  // CLIENT: load day assignments and render
  async function loadDay(dateStr) {
    const container = document.getElementById('main');
    container.innerHTML = '<div class="loading">Chargement…</div>';
    try {
      const rows = await fetchJson(`/api/day/${dateStr}`);
      renderDay(rows, dateStr);
    } catch (err) {
      container.innerHTML = `<div class="error">Erreur: ${err && err.body && err.body.error ? err.body.error : 'Impossible de charger'}</div>`;
    }
  }

  function createStars(currentScore, clickable, onSet) {
    const wrap = document.createElement('div');
    wrap.className = 'stars';
    for (let i = 1; i <= 5; i++) {
      const star = document.createElement('button');
      star.className = 'star' + (i <= currentScore ? ' filled' : '');
      star.textContent = '★';
      star.setAttribute('aria-label', `Donner ${i} étoile(s)`);
      star.disabled = !clickable;
      if (clickable) {
        star.addEventListener('click', () => onSet(i));
      }
      wrap.appendChild(star);
    }
    return wrap;
  }

  async function setRating(assignment_id, score) {
    try {
      await fetchJson('/api/ratings', { method: 'POST', body: { assignment_id, score } });
      await loadDay(fmtDate(currentDate));
    } catch (err) {
      alert('Erreur en enregistrant la note: ' + (err && err.body && err.body.error ? err.body.error : 'erreur'));
    }
  }

  function renderDay(rows, dateStr) {
    const container = document.getElementById('main');
    container.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'day-header';
    const d = new Date(dateStr + 'T00:00:00');
    header.innerHTML = `
      <button id="prev" class="nav-btn">&larr;</button>
      <div class="date-label">${displayDateLabel(d)}</div>
      <button id="next" class="nav-btn">&rarr;</button>
    `;
    container.appendChild(header);

    document.getElementById('prev').addEventListener('click', () => {
      currentDate.setDate(currentDate.getDate() - 1);
      loadDay(fmtDate(currentDate));
    });
    document.getElementById('next').addEventListener('click', () => {
      currentDate.setDate(currentDate.getDate() + 1);
      loadDay(fmtDate(currentDate));
    });

    const today = new Date(); today.setHours(0,0,0,0);
    const requested = new Date(dateStr + 'T00:00:00');
    const allowEdit = requested >= today;

    // map meals to slots (slot 1 and 2)
    const meals = { dejeuner: [], diner: [] };
    for (const r of rows) {
      const slotIndex = r.slot ? r.slot - 1 : 0;
      meals[r.meal] = meals[r.meal] || [];
      meals[r.meal][slotIndex] = r;
    }

    const twoCols = document.createElement('div');
    twoCols.className = 'two-halves';

    ['dejeuner','diner'].forEach(meal => {
      const part = document.createElement('div');
      part.className = 'half ' + meal;
      const title = document.createElement('div');
      title.className = 'meal-title';
      title.textContent = meal === 'dejeuner' ? 'Déjeuner' : 'Dîner';
      part.appendChild(title);

      // render up to 2 slots
      for (let slot = 1; slot <= 2; slot++) {
        const assignment = (meals[meal] && meals[meal][slot-1]) ? meals[meal][slot-1] : null;
        const slotWrap = document.createElement('div');
        slotWrap.className = 'meal-slot';
        if (!assignment) {
          const empty = document.createElement('div');
          empty.className = 'no-menu';
          empty.textContent = `Aucun menu assigné (slot ${slot})`;
          slotWrap.appendChild(empty);
        } else {
          const name = document.createElement('div');
          name.className = 'menu-name';
          name.textContent = assignment.name;
          slotWrap.appendChild(name);

          const avg = document.createElement('div');
          avg.className = 'menu-avg';
          avg.textContent = assignment.avg_score ? `Moyenne: ${assignment.avg_score}` : 'Moyenne: —';
          slotWrap.appendChild(avg);

          const userScore = assignment.user_score || 0;
          const stars = createStars(userScore, sessionUser && allowEdit, (s) => setRating(assignment.assignment_id, s));
          slotWrap.appendChild(stars);

          if (!sessionUser) {
            const hint = document.createElement('div');
            hint.className = 'hint';
            hint.textContent = 'Connectez-vous pour noter';
            slotWrap.appendChild(hint);
          } else if (!allowEdit) {
            const hint2 = document.createElement('div');
            hint2.className = 'hint';
            hint2.textContent = 'Les notes pour les jours passés ne sont pas modifiables';
            slotWrap.appendChild(hint2);
          }
        }
        part.appendChild(slotWrap);
      }

      twoCols.appendChild(part);
    });

    container.appendChild(twoCols);
  }

  // ADMIN: functions
  async function refreshCaches() {
    try {
      menusCache = await fetchJson('/api/menus?sort=alpha');
    } catch (e) {
      menusCache = [];
    }
    try {
      upcomingCache = await fetchJson('/api/upcoming?days=7');
    } catch (e) {
      upcomingCache = [];
    }
  }

  async function adminCreateMenu(name) {
    if (!name || !name.trim()) return alert('Nom requis');
    try {
      await fetchJson('/api/menus', { method: 'POST', body: { name } });
      await refreshCaches();
      renderAdmin();
    } catch (err) {
      alert('Erreur création menu: ' + (err && err.body && err.body.error ? err.body.error : 'erreur'));
    }
  }

  async function adminAssign(menu_id, date, meal, slot) {
    try {
      const body = { menu_id, date, meal };
      if (slot) body.slot = slot;
      await fetchJson('/api/assignments', { method: 'POST', body });
      await refreshCaches();
      renderAdmin();
    } catch (err) {
      alert('Erreur assignation: ' + (err && err.body && err.body.error ? err.body.error : 'erreur'));
    }
  }

  // Admin UI: menus list (with stats) and upcoming assignment grid
  function renderAdmin() {
    const container = document.getElementById('main');
    container.innerHTML = '';

    const adminHeader = document.createElement('div');
    adminHeader.className = 'admin-controls';

    const sortSel = document.createElement('select');
    const opts = [
      { v: 'alpha', l: 'Alphabétique' },
      { v: 'frequency', l: 'Par fréquence' },
      { v: 'rating', l: 'Par note moyenne' }
    ];
    opts.forEach(o => {
      const opt = document.createElement('option');
      opt.value = o.v;
      opt.textContent = o.l;
      sortSel.appendChild(opt);
    });
    sortSel.addEventListener('change', async () => {
      const sort = sortSel.value;
      menusCache = await fetchJson(`/api/menus?sort=${sort}`);
      renderAdmin();
    });
    adminHeader.appendChild(sortSel);

    const input = document.createElement('input');
    input.placeholder = 'Nouveau menu (nom)';
    input.style.padding = '8px';
    adminHeader.appendChild(input);

    const addBtn = document.createElement('button');
    addBtn.className = 'btn';
    addBtn.textContent = 'Créer';
    addBtn.addEventListener('click', () => adminCreateMenu(input.value));
    adminHeader.appendChild(addBtn);

    container.appendChild(adminHeader);

    // Modal to edit an existing menu (opens when cuisinier clicks "Modifier")
    function showEditMenuModal(menu) {
      const overlay = document.createElement('div');
      overlay.className = 'overlay';
      overlay.innerHTML = `
        <div class="login-box">
          <h3>Modifier le repas</h3>
          <label>Nom<br/><input id="edit-menu-name" value="${menu.name}" /></label>
          <div class="login-actions">
            <button id="edit-save" class="btn">Enregistrer</button>
            <button id="edit-cancel" class="btn hollow">Annuler</button>
          </div>
          <div id="edit-error" class="error" style="display:none"></div>
        </div>
      `;
      document.body.appendChild(overlay);
      document.getElementById('edit-cancel').addEventListener('click', () => overlay.remove());
      document.getElementById('edit-save').addEventListener('click', async () => {
        const newName = document.getElementById('edit-menu-name').value.trim();
        if (!newName) {
          const e = document.getElementById('edit-error');
          e.style.display = 'block';
          e.textContent = 'Le nom est requis';
          return;
        }
        try {
          await adminEditMenu(menu.id, newName);
          overlay.remove();
        } catch (err) {
          const e = document.getElementById('edit-error');
          e.style.display = 'block';
          e.textContent = (err && err.body && err.body.error) ? err.body.error : 'Erreur';
        }
      });
    }

    async function adminEditMenu(id, newName) {
      try {
        await fetchJson(`/api/menus/${id}`, { method: 'PUT', body: { name: newName } });
        await refreshCaches();
        renderAdmin();
      } catch (err) {
        throw err;
      }
    }

    // Menus list
    const list = document.createElement('div');
    list.className = 'menu-list';
    menusCache.forEach(m => {
      const item = document.createElement('div');
      item.className = 'menu-item';
      const left = document.createElement('div');
      left.innerHTML = `<div style="font-weight:600">${m.name}</div><div class="menu-meta">Propositions: ${m.nombre_total_assignations} · Moyenne: ${m.note_moyenne !== null ? m.note_moyenne : '—'} · Tendance: ${m.tendance}</div>`;
      item.appendChild(left);

      const right = document.createElement('div');
      right.style.display = 'flex';
      right.style.flexDirection = 'column';
      right.style.gap = '6px';

      const editBtn = document.createElement('button');
      editBtn.className = 'btn small';
      editBtn.textContent = 'Modifier';
      editBtn.addEventListener('click', () => showEditMenuModal(m));
      right.appendChild(editBtn);

      item.appendChild(right);
      list.appendChild(item);
    });
    container.appendChild(list);

    // Upcoming assignment grid (days 0..7)
    const gridWrap = document.createElement('div');
    gridWrap.style.marginTop = '12px';
    const gridTitle = document.createElement('div');
    gridTitle.style.fontWeight = '700';
    gridTitle.textContent = "Planning (aujourd'hui → +7 jours)";
    gridWrap.appendChild(gridTitle);

    const grid = document.createElement('div');
    grid.className = 'calendar';

    const start = new Date(); start.setHours(0,0,0,0);
    for (let i = 0; i <= 7; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const dateStr = fmtDate(d);

      const cell = document.createElement('div');
      cell.className = 'day';

      const dayLabel = document.createElement('div');
      dayLabel.style.fontWeight = '600';
      dayLabel.style.marginBottom = '6px';
      dayLabel.textContent = d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
      cell.appendChild(dayLabel);

      // find assignments for that date and map to slots
      const dayEntry = upcomingCache.find(e => e.date === dateStr);
      const lunchSlots = {1: {name: '—', menu_id: null}, 2: {name: '—', menu_id: null}};
      const dinnerSlots = {1: {name: '—', menu_id: null}, 2: {name: '—', menu_id: null}};
      if (dayEntry && Array.isArray(dayEntry.assignments)) {
        for (const a of dayEntry.assignments) {
          const s = a.slot ? a.slot : 1;
          if (a.meal === 'dejeuner') {
            lunchSlots[s] = { name: a.name, menu_id: a.menu_id, assignment_id: a.assignment_id };
          }
          if (a.meal === 'diner') {
            dinnerSlots[s] = { name: a.name, menu_id: a.menu_id, assignment_id: a.assignment_id };
          }
        }
      }

      // Lunch title
      const lunchDiv = document.createElement('div');
      lunchDiv.style.fontWeight = '600';
      lunchDiv.style.marginBottom = '4px';
      lunchDiv.textContent = 'Déjeuner';
      cell.appendChild(lunchDiv);

      for (let s = 1; s <= 2; s++) {
        const slot = lunchSlots[s];
        const slotDiv = document.createElement('div');
        slotDiv.style.fontSize = '13px';
        slotDiv.style.marginBottom = '4px';
        slotDiv.textContent = `Slot ${s}: ${slot.name}`;
        cell.appendChild(slotDiv);

        const lunchSel = document.createElement('select');
        const optEmptyL = document.createElement('option');
        optEmptyL.value = '';
        optEmptyL.textContent = 'Affecter…';
        lunchSel.appendChild(optEmptyL);
        menusCache.forEach(mm => {
          const o = document.createElement('option');
          o.value = mm.id;
          o.textContent = mm.name;
          lunchSel.appendChild(o);
        });
        if (slot.menu_id) lunchSel.value = slot.menu_id;
        lunchSel.addEventListener('change', () => {
          const menuId = Number(lunchSel.value);
          if (!menuId) return;
          adminAssign(menuId, dateStr, 'dejeuner', s);
        });
        cell.appendChild(lunchSel);
      }

      // Dinner title
      const dinnerDiv = document.createElement('div');
      dinnerDiv.style.fontWeight = '600';
      dinnerDiv.style.marginTop = '6px';
      dinnerDiv.style.marginBottom = '4px';
      dinnerDiv.textContent = 'Dîner';
      cell.appendChild(dinnerDiv);

      for (let s = 1; s <= 2; s++) {
        const slot = dinnerSlots[s];
        const slotDiv = document.createElement('div');
        slotDiv.style.fontSize = '13px';
        slotDiv.style.marginBottom = '4px';
        slotDiv.textContent = `Slot ${s}: ${slot.name}`;
        cell.appendChild(slotDiv);

        const dinnerSel = document.createElement('select');
        const optEmptyD = document.createElement('option');
        optEmptyD.value = '';
        optEmptyD.textContent = 'Affecter…';
        dinnerSel.appendChild(optEmptyD);
        menusCache.forEach(mm => {
          const o = document.createElement('option');
          o.value = mm.id;
          o.textContent = mm.name;
          dinnerSel.appendChild(o);
        });
        if (slot.menu_id) dinnerSel.value = slot.menu_id;
        dinnerSel.addEventListener('change', () => {
          const menuId = Number(dinnerSel.value);
          if (!menuId) return;
          adminAssign(menuId, dateStr, 'diner', s);
        });
        cell.appendChild(dinnerSel);
      }

      grid.appendChild(cell);
    }

    gridWrap.appendChild(grid);
    container.appendChild(gridWrap);
  }

  // Header rendering (adds admin toggle if cuisinier)
  function renderHeader() {
    const header = document.createElement('header');
    header.className = 'app-header';
    const title = document.createElement('h1');
    title.textContent = 'Mes Menus';
    header.appendChild(title);

    const right = document.createElement('div');
    right.className = 'header-right';

    const userDiv = document.createElement('div');
    userDiv.id = 'user-info';
    if (sessionUser) {
      userDiv.innerHTML = `<span class="username">${sessionUser.username} ${sessionUser.role === 'cuisinier' ? '(cuisinier)' : ''}</span>`;
      const btnLogout = document.createElement('button');
      btnLogout.className = 'btn small';
      btnLogout.textContent = 'Déconnexion';
      btnLogout.addEventListener('click', logout);
      userDiv.appendChild(btnLogout);
      if (sessionUser.role === 'cuisinier') {
        const adminBtn = document.createElement('button');
        adminBtn.className = 'btn small';
        adminBtn.textContent = isAdminView ? 'Mode client' : 'Mode cuisinier';
        adminBtn.addEventListener('click', async () => {
          // toggle admin/client view and re-render header+main
          isAdminView = !isAdminView;
          if (isAdminView) {
            await refreshCaches();
          }
          await render();
        });
        userDiv.appendChild(adminBtn);
      }
    } else {
      const btnLogin = document.createElement('button');
      btnLogin.className = 'btn small';
      btnLogin.textContent = 'Se connecter';
      btnLogin.addEventListener('click', () => showLogin());
      userDiv.appendChild(btnLogin);
    }
    right.appendChild(userDiv);

    header.appendChild(right);
    return header;
  }

  function showLogin() {
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    overlay.innerHTML = `
      <div class="login-box">
        <h3>Connexion</h3>
        <label>Nom d'utilisateur<br/><input id="login-username" /></label>
        <label>Mot de passe<br/><input id="login-password" type="password" /></label>
        <div class="login-actions">
          <button id="login-submit" class="btn">Se connecter</button>
          <button id="login-cancel" class="btn hollow">Annuler</button>
        </div>
        <div id="login-error" class="error" style="display:none"></div>
      </div>
    `;
    document.body.appendChild(overlay);
    document.getElementById('login-cancel').addEventListener('click', () => overlay.remove());
    document.getElementById('login-submit').addEventListener('click', async () => {
      const u = document.getElementById('login-username').value.trim();
      const p = document.getElementById('login-password').value;
      try {
        await login(u, p);
        overlay.remove();
      } catch (err) {
        const e = document.getElementById('login-error');
        e.style.display = 'block';
        e.textContent = err && err.body && err.body.error ? err.body.error : 'Erreur de connexion';
      }
    });
  }

  async function render() {
    app.innerHTML = '';
    app.appendChild(renderHeader());
    const main = document.createElement('main');
    main.id = 'main';
    app.appendChild(main);

    if (isAdminView && sessionUser && sessionUser.role === 'cuisinier') {
      await refreshCaches();
      renderAdmin();
    } else {
      await loadDay(fmtDate(currentDate));
    }
  }

  // Init
  (async function init() {
    try {
      await getSession();
      await refreshCaches();
    } catch (e) {
      // ignore
    }
    render();
  })();

})();