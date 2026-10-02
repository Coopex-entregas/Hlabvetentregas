const state = {
  me: null,
  users: [],
  locations: [],
  view: 'home',
  closingMode: 'week',
  selectedUser: '',
  lastDeliveries: []
};

const app = document.querySelector('#app');
const modalRoot = document.querySelector('#modal-root');
const toastEl = document.querySelector('#toast');

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const shortDate = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
const weekday = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'UTC' });

boot();

async function boot() {
  try {
    const status = await api('/api/status');
    if (status.setup_needed) return renderAuth(true);
    try {
      const result = await api('/api/me');
      state.me = result.user;
      await enterApp();
    } catch {
      renderAuth(false);
    }
  } catch (error) {
    app.innerHTML = `<div class="auth-page"><div class="auth-card"><h2>Não foi possível abrir</h2><p>${esc(error.message)}</p><button class="btn btn-primary btn-block" onclick="location.reload()">Tentar novamente</button></div></div>`;
  }
}

function renderAuth(setup) {
  app.innerHTML = `
    <main class="auth-page">
      <div class="auth-wrap">
        <div class="auth-brand"><div class="brand-mark">H</div><div><h1>HLabVet Entregas</h1><p>Controle de rotas e ganhos</p></div></div>
        <section class="auth-card">
          <h2>${setup ? 'Primeiro acesso' : 'Entrar no sistema'}</h2>
          <p>${setup ? 'Crie agora a conta principal do administrador.' : 'Use seu login e sua senha para continuar.'}</p>
          <form id="${setup ? 'setup-form' : 'login-form'}">
            ${setup ? `<div class="field"><label>Nome do administrador</label><input class="input" name="name" required maxlength="80" autocomplete="name"></div>` : ''}
            <div class="field"><label>Login</label><input class="input" name="login" required maxlength="40" autocomplete="username" autocapitalize="none"></div>
            <div class="field"><label>Senha</label><input class="input" name="password" type="password" minlength="6" required autocomplete="${setup ? 'new-password' : 'current-password'}"></div>
            <button class="btn btn-primary btn-block" type="submit">${setup ? 'Criar administrador' : 'Entrar'}</button>
          </form>
        </section>
      </div>
    </main>`;
}

async function enterApp() {
  await refreshCore();
  renderShell();
  await navigate('home');
  if (state.me.must_change_password) openPasswordModal(true);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
}

async function refreshCore() {
  const locations = await api(`/api/locations${state.me.role === 'admin' ? '?all=1' : ''}`);
  state.locations = locations.locations;
  if (state.me.role === 'admin') {
    const users = await api('/api/users');
    state.users = users.users.filter((user) => user.role === 'cooperado');
    if (!state.selectedUser || !state.users.some((user) => user.id === state.selectedUser)) {
      state.selectedUser = state.users.find((user) => user.active)?.id || '';
    }
  } else {
    state.selectedUser = state.me.id;
  }
}

function renderShell() {
  const admin = state.me.role === 'admin';
  const nav = [
    ['home', '⌂', 'Início'],
    ['launch', '＋', 'Lançar'],
    ['deliveries', '☷', 'Entregas'],
    ['closings', 'R$', 'Fechamentos'],
    ...(admin ? [['management', '⚙', 'Cadastros']] : [])
  ];
  app.innerHTML = `
    <div class="app-shell">
      <header class="topbar">
        <div class="topbar-brand"><div class="brand-mark">H</div><div class="topbar-title">HLabVet Entregas<span class="topbar-subtitle">${admin ? 'Administração' : 'Minha rota semanal'}</span></div></div>
        <button class="user-button" data-action="profile">${esc(firstName(state.me.name))}</button>
      </header>
      <main class="content" id="page"></main>
      <nav class="bottom-nav" style="--nav-count:${nav.length}">
        ${nav.map(([id, icon, label]) => `<button class="nav-item" data-nav="${id}"><span class="nav-icon">${icon}</span><span>${label}</span></button>`).join('')}
      </nav>
    </div>`;
}

async function navigate(view) {
  state.view = view;
  document.querySelectorAll('[data-nav]').forEach((button) => button.classList.toggle('active', button.dataset.nav === view));
  const page = document.querySelector('#page');
  if (!page) return;
  page.innerHTML = loading();
  window.scrollTo({ top: 0, behavior: 'smooth' });
  try {
    if (view === 'home') await renderHome(page);
    if (view === 'launch') renderLaunch(page);
    if (view === 'deliveries') renderDeliveries(page);
    if (view === 'closings') await renderClosings(page);
    if (view === 'management') renderManagement(page);
  } catch (error) {
    page.innerHTML = errorCard(error.message);
  }
}

async function renderHome(page) {
  const today = todayISO();
  if (state.me.role === 'admin') {
    const data = await api(`/api/admin/dashboard?date=${today}`);
    const totals = data.cooperados.reduce((sum, row) => ({
      deliveries: sum.deliveries + row.day.delivery_count,
      extras: sum.extras + row.day.extra_count,
      amount: sum.amount + row.day.extra_amount
    }), { deliveries: 0, extras: 0, amount: 0 });
    page.innerHTML = `
      ${pageHead('Visão de hoje', 'Acompanhe cada cooperado em tempo real.', `<span class="badge badge-success"><span class="dot"></span> Atualizado</span>`)}
      <div class="grid grid-3">
        ${metric('Entregas de hoje', totals.deliveries, 'Registradas por todos')}
        ${metric('Extras de hoje', totals.extras, 'Entregas cobradas', 'extra')}
        ${metric('Valor extra hoje', brl.format(totals.amount), 'Total dos cooperados', 'success')}
      </div>
      <section class="card" style="margin-top:16px">
        <div class="card-title"><h2>Cooperados hoje</h2><button class="btn btn-small btn-primary" data-nav="launch">+ Lançar</button></div>
        ${data.cooperados.length ? `<div class="list">${data.cooperados.map(adminPersonCard).join('')}</div>` : empty('Nenhum cooperado ativo', 'Cadastre o primeiro cooperado na aba Cadastros.')}
      </section>`;
    return;
  }

  const [week, month] = await Promise.all([
    api(`/api/week?date=${today}`),
    api(`/api/month?month=${today.slice(0, 7)}`)
  ]);
  const c = week.calculation;
  page.innerHTML = `
    ${pageHead(`Olá, ${esc(firstName(state.me.name))}`, `Semana de ${fmtDate(week.week_start)} a ${fmtDate(week.week_end)}.`)}
    <section class="card hero-card">
      <span class="eyebrow">TOTAL DA SEMANA</span>
      <div class="hero-value">${brl.format(c.total_amount)}</div>
      <p>${brl.format(c.base_amount)} fixo + ${brl.format(c.extra_amount)} em extras</p>
      <div class="hero-actions"><button class="btn btn-white" data-nav="launch">+ Nova entrega</button><button class="btn" data-action="go-week">Ver fechamento</button></div>
    </section>
    <div class="grid grid-3" style="margin-top:14px">
      ${metric('Entregas', c.delivery_count, 'Nesta semana')}
      ${metric('Extras', c.extra_count, 'Acima das regras', 'extra')}
      ${metric('Extras em R$', brl.format(c.extra_amount), 'Somados ao fixo', 'success')}
    </div>
    <section class="card" style="margin-top:16px">
      <div class="card-title"><h2>Progresso da semana</h2><span class="badge">Seg a sáb</span></div>
      <div class="progress-head"><span>Segunda a sexta</span><strong>${c.weekday_used} / ${c.weekday_included} incluídas</strong></div>
      <div class="progress"><span style="width:${Math.min(100, c.weekday_used / Math.max(1, c.weekday_included) * 100)}%"></span></div>
      <div class="notice" style="margin-top:15px">A partir da ${c.weekday_included + 1}ª entrega de segunda a sexta, o sistema começa a somar os valores extras conforme o local.</div>
    </section>
    <section class="card" style="margin-top:16px">
      <div class="card-title"><h2>Resumo mensal</h2><span class="badge">${monthName(month.month)}</span></div>
      <div class="grid grid-3">
        ${metric('Entregas', month.summary.delivery_count, 'No mês')}
        ${metric('Extras', brl.format(month.summary.extra_amount), `${month.summary.extra_count} entregas`, 'extra')}
        ${metric('Total', brl.format(month.summary.total_amount), `${month.weeks.length} semanas`, 'success')}
      </div>
    </section>`;
}

function adminPersonCard(row) {
  const c = row.week.calculation;
  return `<div class="list-item">
    <div class="person"><div class="avatar">${initials(row.user.name)}</div><div class="list-main"><strong>${esc(row.user.name)}</strong><small>Hoje: ${row.day.delivery_count} entregas • ${row.day.extra_count} extras</small></div></div>
    <div class="list-value"><strong>${brl.format(c.total_amount)}</strong><small>semana</small></div>
  </div>`;
}

function renderLaunch(page) {
  const activeLocations = state.locations.filter((location) => location.active);
  const userField = state.me.role === 'admin' ? userSelect(state.selectedUser, true) : '';
  page.innerHTML = `
    ${pageHead('Lançar entregas', 'Registre rapidamente cada rota realizada.')}
    <section class="card">
      <form id="launch-form">
        ${userField}
        <div class="form-grid">
          <div class="field"><label>Data da entrega</label><input class="input" type="date" name="delivery_date" value="${safeWorkDate(todayISO())}" required></div>
          <div class="field"><label>Local</label><select class="select" name="location_id" required><option value="">Selecione</option>${activeLocations.map(locationOption).join('')}</select></div>
        </div>
        <div class="form-grid">
          <div class="field"><label>Quantidade</label><input class="input" type="number" name="quantity" value="1" min="1" max="50" required><small>Você pode lançar várias entregas iguais de uma vez.</small></div>
          <div class="field"><label>Observação (opcional)</label><input class="input" name="notes" maxlength="180" placeholder="Ex.: coleta urgente"></div>
        </div>
        <button class="btn btn-primary btn-block" type="submit">Salvar entrega</button>
      </form>
    </section>
    <section class="card" style="margin-top:16px">
      <div class="card-title"><h2>Valores cadastrados</h2><span class="badge">Automático</span></div>
      <div class="list">${activeLocations.map((location) => `<div class="list-item"><div class="list-main"><strong>${esc(location.name)}</strong><small>${categoryName(location.category)}</small></div><div class="list-value"><strong>${brl.format(location.weekday_value)}</strong><small>extra</small></div></div>`).join('')}</div>
    </section>`;
}

function renderDeliveries(page) {
  const today = todayISO();
  const monthStart = `${today.slice(0, 7)}-01`;
  page.innerHTML = `
    ${pageHead('Entregas', 'Consulte qualquer período e veja quanto entrou de extra.')}
    <section class="card">
      <form id="delivery-filter" class="toolbar">
        ${state.me.role === 'admin' ? `<div class="field wide"><label>Cooperado</label>${userSelectRaw(state.selectedUser)}</div>` : ''}
        <div class="field"><label>De</label><input class="input" type="date" name="from" value="${monthStart}" required></div>
        <div class="field"><label>Até</label><input class="input" type="date" name="to" value="${today}" required></div>
        <div class="toolbar-actions"><button class="btn btn-primary" type="submit">Buscar</button><button class="btn btn-outline" type="button" data-action="export-csv">CSV</button></div>
      </form>
      <div id="delivery-results">${loading()}</div>
    </section>`;
  document.querySelector('#delivery-filter').requestSubmit();
}

async function loadDeliveries(form) {
  const data = Object.fromEntries(new FormData(form));
  state.selectedUser = data.user_id || state.selectedUser;
  const query = new URLSearchParams({ from: data.from, to: data.to });
  if (state.me.role === 'admin') query.set('user_id', state.selectedUser);
  const target = document.querySelector('#delivery-results');
  target.innerHTML = loading();
  try {
    const result = await api(`/api/deliveries?${query}`);
    state.lastDeliveries = result.deliveries;
    target.innerHTML = `
      <div class="grid grid-3" style="margin-bottom:15px">
        ${metric('Entregas', result.summary.delivery_count, 'No período')}
        ${metric('Extras', result.summary.extra_count, 'Cobradas', 'extra')}
        ${metric('Valor extra', brl.format(result.summary.extra_amount), 'No período', 'success')}
      </div>
      ${result.deliveries.length ? `<div class="list">${result.deliveries.slice().reverse().map(deliveryCard).join('')}</div>` : empty('Nenhuma entrega', 'Não existem lançamentos nesse período.')}`;
  } catch (error) {
    target.innerHTML = errorCard(error.message);
  }
}

function deliveryCard(item) {
  return `<div class="list-item">
    <div class="list-main"><strong>${esc(item.location_name)}</strong><small>${fmtDate(item.delivery_date)} • ${esc(item.rule_reason)}</small>${item.notes ? `<small> • ${esc(item.notes)}</small>` : ''}</div>
    <div class="list-actions">
      <span class="badge ${item.is_extra ? 'badge-success' : ''}">${item.is_extra ? brl.format(item.extra_value) : 'Incluída'}</span>
      <button class="btn btn-small" data-action="edit-delivery" data-id="${item.id}">Editar</button>
    </div>
  </div>`;
}

async function renderClosings(page) {
  page.innerHTML = `
    ${pageHead('Fechamentos', 'Períodos automáticos de segunda a sábado e do dia 1º ao fim do mês.')}
    <div class="segmented" style="margin-bottom:16px"><button data-action="closing-mode" data-mode="week" class="${state.closingMode === 'week' ? 'active' : ''}">Semanal</button><button data-action="closing-mode" data-mode="month" class="${state.closingMode === 'month' ? 'active' : ''}">Mensal</button></div>
    <div id="closing-content">${loading()}</div>`;
  if (state.closingMode === 'week') await loadWeekClosing(); else await loadMonthClosing();
}

async function loadWeekClosing(date = todayISO()) {
  const target = document.querySelector('#closing-content');
  const params = new URLSearchParams({ date });
  if (state.me.role === 'admin') params.set('user_id', state.selectedUser);
  try {
    const data = await api(`/api/week?${params}`);
    const c = data.calculation;
    target.innerHTML = `
      <section class="card">
        <form id="week-filter" class="toolbar">
          ${state.me.role === 'admin' ? `<div class="field wide"><label>Cooperado</label>${userSelectRaw(state.selectedUser)}</div>` : ''}
          <div class="field"><label>Escolha uma data da semana</label><input class="input" type="date" name="date" value="${date}"></div>
          <div class="toolbar-actions"><button class="btn btn-primary" type="submit">Mostrar</button></div>
        </form>
        <div class="notice ${data.closure ? 'notice-success' : ''}">${data.closure ? `Fechado em ${fmtDateTime(data.closure.closed_at)}.` : 'Fechamento automático no fim do sábado. O administrador também pode atualizar manualmente.'}</div>
      </section>
      <section class="card hero-card" style="margin-top:16px"><span class="eyebrow">${fmtDate(data.week_start)} A ${fmtDate(data.week_end)}</span><div class="hero-value">${brl.format(c.total_amount)}</div><p>${brl.format(c.base_amount)} fixo + ${brl.format(c.extra_amount)} em extras</p><div class="hero-actions"><button class="btn btn-white" data-action="close-week" data-date="${date}">${data.closure ? 'Atualizar fechamento' : 'Fechar agora'}</button></div></section>
      <div class="grid grid-3" style="margin-top:14px">${metric('Entregas', c.delivery_count, 'Total')}${metric('Extras', c.extra_count, 'Cobradas', 'extra')}${metric('Valor extra', brl.format(c.extra_amount), 'Acima do fixo', 'success')}</div>
      <section class="card" style="margin-top:16px"><div class="card-title"><h2>Dia a dia</h2><span class="badge">Seg a sáb</span></div>${data.days.length ? `<div class="grid grid-2">${data.days.map(dayCard).join('')}</div>` : empty('Semana sem entregas', 'Nenhum lançamento neste período.')}</section>`;
  } catch (error) { target.innerHTML = errorCard(error.message); }
}

async function loadMonthClosing(month = todayISO().slice(0, 7)) {
  const target = document.querySelector('#closing-content');
  const params = new URLSearchParams({ month });
  if (state.me.role === 'admin') params.set('user_id', state.selectedUser);
  try {
    const data = await api(`/api/month?${params}`);
    const s = data.summary;
    target.innerHTML = `
      <section class="card"><form id="month-filter" class="toolbar">${state.me.role === 'admin' ? `<div class="field wide"><label>Cooperado</label>${userSelectRaw(state.selectedUser)}</div>` : ''}<div class="field"><label>Mês</label><input class="input" type="month" name="month" value="${month}"></div><div class="toolbar-actions"><button class="btn btn-primary" type="submit">Mostrar</button></div></form><div class="notice ${data.closure ? 'notice-success' : ''}">${data.closure ? `Mês fechado automaticamente em ${fmtDateTime(data.closure.closed_at)}.` : 'O mês fecha automaticamente no primeiro dia do mês seguinte.'}</div></section>
      <section class="card hero-card" style="margin-top:16px"><span class="eyebrow">${monthName(month).toUpperCase()}</span><div class="hero-value">${brl.format(s.total_amount)}</div><p>${brl.format(s.base_amount)} em semanas + ${brl.format(s.extra_amount)} em extras</p></section>
      <div class="grid grid-3" style="margin-top:14px">${metric('Entregas', s.delivery_count, 'No mês')}${metric('Extras', s.extra_count, 'Cobradas', 'extra')}${metric('Valor extra', brl.format(s.extra_amount), 'No mês', 'success')}</div>
      <section class="card" style="margin-top:16px"><div class="card-title"><h2>Semanas do mês</h2><span class="badge">${data.weeks.length}</span></div><div class="list">${data.weeks.map((week) => `<div class="list-item"><div class="list-main"><strong>${fmtDate(week.week_start)} a ${fmtDate(week.week_end)}</strong><small>${week.delivery_count} entregas • ${week.extra_count} extras</small></div><div class="list-value"><strong>${brl.format(week.total_amount)}</strong><small>${week.closed ? 'fechada' : 'em andamento'}</small></div></div>`).join('')}</div></section>`;
  } catch (error) { target.innerHTML = errorCard(error.message); }
}

function renderManagement(page) {
  if (state.me.role !== 'admin') return navigate('home');
  page.innerHTML = `
    ${pageHead('Cadastros', 'Gerencie cooperados, locais, valores e regras.')}
    <section class="card">
      <div class="card-title"><h2>Cooperados</h2><button class="btn btn-small btn-primary" data-action="new-user">+ Cadastrar</button></div>
      ${state.users.length ? `<div class="list">${state.users.map(userCard).join('')}</div>` : empty('Nenhum cooperado', 'Cadastre o primeiro acesso.')}
    </section>
    <section class="card" style="margin-top:16px">
      <div class="card-title"><h2>Locais e valores</h2><button class="btn btn-small btn-primary" data-action="new-location">+ Local</button></div>
      <div class="list">${state.locations.map(locationCard).join('')}</div>
    </section>
    <section class="card" style="margin-top:16px">
      <div class="card-title"><h2>Regras automáticas</h2><span class="badge">Seg a sáb</span></div>
      <form id="settings-form"><div id="settings-fields">${loading()}</div></form>
    </section>`;
  loadSettingsForm();
}

async function loadSettingsForm() {
  try {
    const data = await api('/api/settings');
    document.querySelector('#settings-fields').innerHTML = `<div class="form-grid"><div class="field"><label>Entregas incluídas de segunda a sexta</label><input class="input" type="number" min="0" max="100" name="weekday_included" value="${data.settings.weekday_included}" required></div><div class="field"><label>Entregas de Natal incluídas no sábado</label><input class="input" type="number" min="0" max="100" name="weekend_natal_included" value="${data.settings.weekend_natal_included}" required></div></div><div class="notice">Fora de Natal no sábado é cobrado integralmente. Os valores vêm do cadastro de cada local.</div><button class="btn btn-primary" style="margin-top:15px" type="submit">Salvar regras</button>`;
  } catch (error) { document.querySelector('#settings-fields').innerHTML = errorCard(error.message); }
}

function userCard(user) {
  return `<div class="list-item"><div class="person"><div class="avatar">${initials(user.name)}</div><div class="list-main"><strong>${esc(user.name)}</strong><small>@${esc(user.login)} • ${brl.format(user.weekly_base_amount)}/semana</small></div></div><div class="list-actions"><span class="badge ${user.active ? 'badge-success' : 'badge-danger'}">${user.active ? 'Ativo' : 'Inativo'}</span><button class="btn btn-small" data-action="edit-user" data-id="${user.id}">Editar</button></div></div>`;
}

function locationCard(location) {
  return `<div class="list-item"><div class="list-main"><strong>${esc(location.name)}</strong><small>${categoryName(location.category)} • Seg–sex ${brl.format(location.weekday_value)} • Sáb ${brl.format(location.weekend_value)}</small></div><div class="list-actions"><span class="badge ${location.active ? 'badge-success' : 'badge-danger'}">${location.active ? 'Ativo' : 'Inativo'}</span><button class="btn btn-small" data-action="edit-location" data-id="${location.id}">Editar</button></div></div>`;
}

function openUserModal(user = null) {
  const edit = Boolean(user);
  showModal(`
    <div class="modal-head"><h2>${edit ? 'Editar cooperado' : 'Novo cooperado'}</h2><button class="btn btn-icon" data-action="close-modal">×</button></div>
    <form id="user-form" data-id="${user?.id || ''}">
      <div class="field"><label>Nome completo</label><input class="input" name="name" value="${escAttr(user?.name || '')}" required maxlength="80"></div>
      <div class="field"><label>Login</label><input class="input" name="login" value="${escAttr(user?.login || '')}" required maxlength="40" autocapitalize="none"></div>
      <div class="field"><label>${edit ? 'Nova senha provisória (opcional)' : 'Senha provisória'}</label><input class="input" name="password" type="password" minlength="6" ${edit ? '' : 'required'}><small>No primeiro acesso, o cooperado será obrigado a criar uma nova senha.</small></div>
      <div class="field"><label>Valor fixo semanal</label><input class="input" name="weekly_base_amount" type="number" step="0.01" min="0" value="${user?.weekly_base_amount ?? 663.33}" required></div>
      ${edit ? `<label class="list-item"><div class="list-main"><strong>Acesso ativo</strong><small>Desative para bloquear o login.</small></div><input type="checkbox" name="active" ${user.active ? 'checked' : ''}></label>` : ''}
      <div class="modal-actions"><button class="btn" type="button" data-action="close-modal">Cancelar</button><button class="btn btn-primary" type="submit">Salvar</button></div>
    </form>`);
}

function openLocationModal(location = null) {
  const edit = Boolean(location);
  showModal(`
    <div class="modal-head"><h2>${edit ? 'Editar local' : 'Novo local'}</h2><button class="btn btn-icon" data-action="close-modal">×</button></div>
    <form id="location-form" data-id="${location?.id || ''}">
      <div class="field"><label>Nome do local</label><input class="input" name="name" value="${escAttr(location?.name || '')}" required maxlength="80"></div>
      <div class="field"><label>Categoria</label><select class="select" name="category"><option value="natal" ${location?.category === 'natal' ? 'selected' : ''}>Natal</option><option value="zona_norte" ${location?.category === 'zona_norte' ? 'selected' : ''}>Zona Norte de Natal</option><option value="fora_natal" ${!location || location.category === 'fora_natal' ? 'selected' : ''}>Fora de Natal</option></select></div>
      <div class="form-grid"><div class="field"><label>Extra de seg. a sex.</label><input class="input" name="weekday_value" type="number" step="0.01" min="0" value="${location?.weekday_value ?? 20}" required></div><div class="field"><label>Extra de sábado</label><input class="input" name="weekend_value" type="number" step="0.01" min="0" value="${location?.weekend_value ?? 20}" required></div></div>
      <input type="hidden" name="sort_order" value="${location?.sort_order ?? 100}">
      ${edit ? `<label class="list-item"><div class="list-main"><strong>Local ativo</strong><small>Aparece no lançamento de entregas.</small></div><input type="checkbox" name="active" ${location.active ? 'checked' : ''}></label>` : ''}
      <div class="modal-actions"><button class="btn" type="button" data-action="close-modal">Cancelar</button><button class="btn btn-primary" type="submit">Salvar</button></div>
    </form>`);
}

function openDeliveryModal(item) {
  showModal(`
    <div class="modal-head"><h2>Editar entrega</h2><button class="btn btn-icon" data-action="close-modal">×</button></div>
    <form id="edit-delivery-form" data-id="${item.id}">
      <div class="field"><label>Data</label><input class="input" type="date" name="delivery_date" value="${item.delivery_date}" required></div>
      <div class="field"><label>Local</label><select class="select" name="location_id">${state.locations.map((location) => `<option value="${location.id}" ${location.id === item.location_id ? 'selected' : ''}>${esc(location.name)}</option>`).join('')}</select></div>
      <div class="field"><label>Observação</label><input class="input" name="notes" value="${escAttr(item.notes || '')}" maxlength="180"></div>
      ${state.me.role === 'admin' ? `<div class="form-grid"><div class="field"><label>Cobrança</label><select class="select" name="billing_mode"><option value="auto" ${item.billing_mode === 'auto' ? 'selected' : ''}>Automática</option><option value="included" ${item.billing_mode === 'included' ? 'selected' : ''}>Forçar incluída</option><option value="extra" ${item.billing_mode === 'extra' ? 'selected' : ''}>Forçar extra</option></select></div><div class="field"><label>Valor personalizado</label><input class="input" type="number" step="0.01" min="0" name="value_override" value="${item.value_override ?? ''}" placeholder="Valor do local"></div></div>` : ''}
      <div class="modal-actions"><button class="btn btn-danger" type="button" data-action="delete-delivery" data-id="${item.id}">Excluir</button><button class="btn btn-primary" type="submit">Salvar</button></div>
    </form>`);
}

function openPasswordModal(forced = false) {
  showModal(`<div class="modal-head"><h2>${forced ? 'Crie sua nova senha' : 'Alterar senha'}</h2>${forced ? '' : '<button class="btn btn-icon" data-action="close-modal">×</button>'}</div><div class="notice">Use pelo menos 6 caracteres. Esta senha será usada nos próximos acessos.</div><form id="password-form" style="margin-top:16px"><div class="field"><label>Nova senha</label><input class="input" type="password" name="password" minlength="6" required autocomplete="new-password"></div><div class="field"><label>Confirme a senha</label><input class="input" type="password" name="confirmation" minlength="6" required autocomplete="new-password"></div><button class="btn btn-primary btn-block" type="submit">Salvar nova senha</button></form>`, !forced);
}

function openProfile() {
  showModal(`<div class="modal-head"><h2>Minha conta</h2><button class="btn btn-icon" data-action="close-modal">×</button></div><div class="person"><div class="avatar">${initials(state.me.name)}</div><div class="list-main"><strong>${esc(state.me.name)}</strong><small>@${esc(state.me.login)} • ${state.me.role === 'admin' ? 'Administrador' : 'Cooperado'}</small></div></div><div class="grid" style="margin-top:20px"><button class="btn btn-outline btn-block" data-action="password">Alterar senha</button><button class="btn btn-danger btn-block" data-action="logout">Sair do sistema</button></div>`);
}

document.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target;
  const button = form.querySelector('[type="submit"]');
  setBusy(button, true);
  try {
    if (form.id === 'setup-form' || form.id === 'login-form') {
      const endpoint = form.id === 'setup-form' ? '/api/setup' : '/api/login';
      const result = await api(endpoint, { method: 'POST', body: formData(form) });
      state.me = result.user;
      await enterApp();
    } else if (form.id === 'password-form') {
      const data = formData(form);
      if (data.password !== data.confirmation) throw new Error('As senhas não são iguais.');
      const result = await api('/api/change-password', { method: 'POST', body: { password: data.password } });
      state.me = result.user;
      closeModal(); toast('Senha alterada com sucesso.');
    } else if (form.id === 'launch-form') {
      const data = formData(form);
      if (state.me.role === 'admin') state.selectedUser = data.user_id;
      await api('/api/deliveries', { method: 'POST', body: data });
      form.querySelector('[name="quantity"]').value = 1;
      form.querySelector('[name="notes"]').value = '';
      toast('Entrega salva e cálculo atualizado.');
    } else if (form.id === 'delivery-filter') {
      await loadDeliveries(form);
    } else if (form.id === 'week-filter') {
      const data = formData(form); state.selectedUser = data.user_id || state.selectedUser; await loadWeekClosing(data.date);
    } else if (form.id === 'month-filter') {
      const data = formData(form); state.selectedUser = data.user_id || state.selectedUser; await loadMonthClosing(data.month);
    } else if (form.id === 'user-form') {
      const data = formData(form); data.weekly_base_amount = Number(data.weekly_base_amount); if (form.dataset.id) data.active = form.elements.active.checked;
      await api(form.dataset.id ? `/api/users/${form.dataset.id}` : '/api/users', { method: form.dataset.id ? 'PATCH' : 'POST', body: data });
      closeModal(); await refreshCore(); toast('Cooperado salvo.'); renderManagement(document.querySelector('#page'));
    } else if (form.id === 'location-form') {
      const data = formData(form); data.weekday_value = Number(data.weekday_value); data.weekend_value = Number(data.weekend_value); data.sort_order = Number(data.sort_order); if (form.dataset.id) data.active = form.elements.active.checked;
      await api(form.dataset.id ? `/api/locations/${form.dataset.id}` : '/api/locations', { method: form.dataset.id ? 'PATCH' : 'POST', body: data });
      closeModal(); await refreshCore(); toast('Local salvo.'); renderManagement(document.querySelector('#page'));
    } else if (form.id === 'settings-form') {
      const data = formData(form); data.weekday_included = Number(data.weekday_included); data.weekend_natal_included = Number(data.weekend_natal_included);
      await api('/api/settings', { method: 'PATCH', body: data }); toast('Regras atualizadas.');
    } else if (form.id === 'edit-delivery-form') {
      const data = formData(form); if (data.value_override === '') data.value_override = null;
      await api(`/api/deliveries/${form.dataset.id}`, { method: 'PATCH', body: data }); closeModal(); toast('Entrega atualizada.'); document.querySelector('#delivery-filter')?.requestSubmit();
    }
  } catch (error) { toast(error.message, true); }
  finally { setBusy(button, false); }
});

document.addEventListener('click', async (event) => {
  const nav = event.target.closest('[data-nav]');
  if (nav) return navigate(nav.dataset.nav);
  const target = event.target.closest('[data-action]');
  if (!target) return;
  const action = target.dataset.action;
  if (action === 'close-modal') closeModal();
  if (action === 'profile') openProfile();
  if (action === 'password') openPasswordModal(false);
  if (action === 'logout') { await api('/api/logout', { method: 'POST' }); state.me = null; closeModal(); renderAuth(false); }
  if (action === 'new-user') openUserModal();
  if (action === 'edit-user') openUserModal(state.users.find((user) => user.id === target.dataset.id));
  if (action === 'new-location') openLocationModal();
  if (action === 'edit-location') openLocationModal(state.locations.find((location) => location.id === target.dataset.id));
  if (action === 'edit-delivery') openDeliveryModal(state.lastDeliveries.find((item) => item.id === target.dataset.id));
  if (action === 'delete-delivery' && confirm('Deseja realmente excluir esta entrega?')) {
    try { await api(`/api/deliveries/${target.dataset.id}`, { method: 'DELETE' }); closeModal(); toast('Entrega excluída.'); document.querySelector('#delivery-filter')?.requestSubmit(); } catch (error) { toast(error.message, true); }
  }
  if (action === 'closing-mode') { state.closingMode = target.dataset.mode; await navigate('closings'); }
  if (action === 'go-week') { state.closingMode = 'week'; await navigate('closings'); }
  if (action === 'close-week') {
    try { await api('/api/week/close', { method: 'POST', body: { date: target.dataset.date, user_id: state.selectedUser } }); toast('Semana fechada com sucesso.'); await loadWeekClosing(target.dataset.date); } catch (error) { toast(error.message, true); }
  }
  if (action === 'export-csv') exportCSV();
});

async function api(path, options = {}) {
  const init = { method: options.method || 'GET', credentials: 'same-origin', headers: {} };
  if (options.body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(options.body); }
  const response = await fetch(path, init);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Não foi possível concluir.');
  return data;
}

function showModal(content, closable = true) {
  modalRoot.innerHTML = `<div class="modal-backdrop" ${closable ? 'data-action="close-modal"' : ''}><div class="modal" onclick="event.stopPropagation()"><div class="modal-inner">${content}</div></div></div>`;
  setTimeout(() => modalRoot.querySelector('input:not([type="hidden"])')?.focus(), 50);
}
function closeModal() { modalRoot.innerHTML = ''; }
function toast(message, error = false) { toastEl.textContent = message; toastEl.className = `toast show${error ? ' error' : ''}`; clearTimeout(toast._timer); toast._timer = setTimeout(() => toastEl.className = 'toast', 3200); }
function setBusy(button, busy) { if (!button) return; button.disabled = busy; if (busy) { button.dataset.label = button.textContent; button.textContent = 'Aguarde...'; } else if (button.dataset.label) button.textContent = button.dataset.label; }
function formData(form) { return Object.fromEntries(new FormData(form).entries()); }

function pageHead(title, subtitle, action = '') { return `<div class="page-head"><div><h1>${title}</h1><p>${subtitle}</p></div>${action}</div>`; }
function metric(label, value, hint, type = '') { return `<div class="card metric ${type}"><span class="metric-label">${label}</span><strong class="metric-value">${value}</strong><small class="metric-hint">${hint}</small></div>`; }
function empty(title, text) { return `<div class="empty"><span class="empty-icon">◌</span><strong>${title}</strong><span>${text}</span></div>`; }
function loading() { return `<div class="loading"><span class="spinner"></span><span>Carregando...</span></div>`; }
function errorCard(message) { return `<div class="notice notice-danger">${esc(message)}</div>`; }
function dayCard(day) { return `<div class="card day-card"><div class="day-head"><strong>${weekday.format(new Date(`${day.date}T12:00:00Z`))}</strong><span class="badge">${day.delivery_count}</span></div><div class="day-stats"><div class="day-stat"><span>Entregas</span><b>${day.delivery_count}</b></div><div class="day-stat"><span>Extras</span><b>${day.extra_count}</b></div><div class="day-stat"><span>Valor</span><b>${brl.format(day.extra_amount)}</b></div></div></div>`; }
function userSelect(selected, withField = false) { const raw = userSelectRaw(selected); return withField ? `<div class="field"><label>Cooperado</label>${raw}</div>` : raw; }
function userSelectRaw(selected) { return `<select class="select" name="user_id" required><option value="">Selecione</option>${state.users.filter((user) => user.active || user.id === selected).map((user) => `<option value="${user.id}" ${user.id === selected ? 'selected' : ''}>${esc(user.name)}</option>`).join('')}</select>`; }
function locationOption(location) { return `<option value="${location.id}">${esc(location.name)} — ${brl.format(location.weekday_value)}</option>`; }
function categoryName(value) { return value === 'natal' ? 'Natal' : value === 'zona_norte' ? 'Zona Norte de Natal' : 'Fora de Natal'; }
function firstName(name) { return String(name).trim().split(/\s+/)[0]; }
function initials(name) { return String(name).trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase(); }
function fmtDate(value) { return shortDate.format(new Date(`${value}T12:00:00Z`)); }
function fmtDateTime(value) { return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Fortaleza' }).format(new Date(value)); }
function monthName(value) { const [year, month] = value.split('-'); return new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(Number(year), Number(month) - 1, 1))); }
function todayISO() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Fortaleza', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
function safeWorkDate(value) { const date = new Date(`${value}T12:00:00Z`); if (date.getUTCDay() === 0) { date.setUTCDate(date.getUTCDate() - 1); return date.toISOString().slice(0, 10); } return value; }
function esc(value) { return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]); }
function escAttr(value) { return esc(value); }

function exportCSV() {
  if (!state.lastDeliveries.length) return toast('Não há entregas para exportar.', true);
  const lines = [['Data', 'Cooperado', 'Local', 'Situação', 'Valor extra', 'Observação'], ...state.lastDeliveries.map((item) => [item.delivery_date, item.user_name, item.location_name, item.is_extra ? 'Extra' : 'Incluída', Number(item.extra_value).toFixed(2).replace('.', ','), item.notes || ''])];
  const csv = '\ufeff' + lines.map((row) => row.map((cell) => `"${String(cell ?? '').replaceAll('"', '""')}"`).join(';')).join('\n');
  const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); link.download = `hlabvet-entregas-${todayISO()}.csv`; link.click(); URL.revokeObjectURL(link.href);
}
