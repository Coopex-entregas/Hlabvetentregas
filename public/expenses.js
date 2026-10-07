let expenseUser = null;
let expenseData = null;
let expenseChecking = false;
let expenseCheckTimer = null;

const expenseMoney = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL'
});
const expenseNumber = new Intl.NumberFormat('pt-BR', {
  maximumFractionDigits: 2
});

installExpenseWatcher();

function installExpenseWatcher() {
  injectExpenseStyles();
  const root = document.querySelector('#app');
  if (!root) return;

  const observer = new MutationObserver(() => {
    clearTimeout(expenseCheckTimer);
    expenseCheckTimer = setTimeout(ensureExpenseNav, 80);
  });
  observer.observe(root, { childList: true, subtree: true });

  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-nav]')) {
      document.querySelector('[data-expense-nav]')?.classList.remove('active');
    }
  });

  ensureExpenseNav();
}

async function ensureExpenseNav() {
  const nav = document.querySelector('.bottom-nav');
  if (!nav || nav.querySelector('[data-expense-nav]') || expenseChecking) return;

  expenseChecking = true;
  try {
    const result = await expenseApi('/api/me');
    expenseUser = result.user;
    if (!expenseUser || expenseUser.role !== 'cooperado') return;

    const button = document.createElement('button');
    button.className = 'nav-item';
    button.type = 'button';
    button.dataset.expenseNav = '1';
    button.innerHTML = '<span class="nav-icon">🏍</span><span>Gastos</span>';
    button.addEventListener('click', openExpensePage);
    nav.appendChild(button);
    nav.style.setProperty('--nav-count', nav.querySelectorAll('.nav-item').length);
  } catch {
    // Sem sessão ou administrador: não exibe a aba.
  } finally {
    expenseChecking = false;
  }
}

async function openExpensePage() {
  const page = document.querySelector('#page');
  if (!page) return;

  document.querySelectorAll('[data-nav]').forEach((button) => button.classList.remove('active'));
  document.querySelector('[data-expense-nav]')?.classList.add('active');

  page.innerHTML = `
    <div class="page-head">
      <div>
        <h1>Gastos do cooperado</h1>
        <p>Calcule combustível, desgaste da moto e o custo real de cada km rodado.</p>
      </div>
      <span class="badge badge-success">Somente você</span>
    </div>
    <div class="loading"><span class="spinner"></span><span>Carregando seus gastos...</span></div>
  `;
  window.scrollTo({ top: 0, behavior: 'smooth' });

  try {
    expenseData = await expenseApi('/api/expenses');
    renderExpensePage();
  } catch (error) {
    page.innerHTML = `<div class="notice notice-danger">${expenseEsc(error.message)}</div>`;
  }
}

function renderExpensePage() {
  const page = document.querySelector('#page');
  if (!page || !expenseData) return;

  const profile = expenseData.profile || {};
  page.innerHTML = `
    <div class="page-head">
      <div>
        <h1>Gastos do cooperado</h1>
        <p>Informe os km rodados e veja na hora quanto foi combustível e desgaste da moto.</p>
      </div>
      <span class="badge badge-success">Privado</span>
    </div>

    <section class="card expense-hero">
      <div class="expense-hero-copy">
        <span class="eyebrow">CUSTO DO PERCURSO</span>
        <div class="expense-total" id="expense-total">${expenseMoney.format(0)}</div>
        <p id="expense-total-hint">Digite os quilômetros rodados.</p>
      </div>
      <div class="expense-km-box">
        <label for="expense-km">Quantos km você rodou?</label>
        <div class="expense-km-entry">
          <input class="input expense-km-input" id="expense-km" type="number"
            min="0" step="0.1" inputmode="decimal"
            value="${expenseInputNumber(profile.last_km || 0)}">
          <span>km</span>
        </div>
      </div>
    </section>

    <div class="grid grid-3 expense-summary" style="margin-top:14px">
      ${expenseMetric('Combustível', 'expense-fuel-total', 'No percurso')}
      ${expenseMetric('Manutenção', 'expense-maint-total', 'Desgaste proporcional')}
      ${expenseMetric('Custo por km', 'expense-cost-km', 'Combustível + manutenção')}
    </div>

    <section class="card" style="margin-top:16px">
      <div class="card-title">
        <div>
          <h2>Combustível</h2>
          <small>Esses dois valores ficam salvos na sua conta.</small>
        </div>
        <span class="badge">Automático</span>
      </div>

      <div class="form-grid">
        <div class="field">
          <label>Quantos km sua moto faz com 1 litro?</label>
          <input class="input" id="expense-kml" type="number"
            min="0.1" step="0.1" inputmode="decimal"
            value="${expenseInputNumber(profile.fuel_km_per_liter || 35)}">
        </div>
        <div class="field">
          <label>Valor do litro do combustível</label>
          <input class="input" id="expense-fuel-price" type="number"
            min="0" step="0.01" inputmode="decimal"
            value="${expenseInputNumber(profile.fuel_price || 0)}">
        </div>
      </div>

      <div class="notice expense-formula" id="expense-fuel-detail"></div>
    </section>

    <section class="card" style="margin-top:16px">
      <div class="card-title expense-title-row">
        <div>
          <h2>Peças e manutenção</h2>
          <small>Altere o valor e a duração em km conforme a sua moto.</small>
        </div>
        <button class="btn btn-small btn-primary" type="button" data-expense-action="add">
          + Adicionar item
        </button>
      </div>

      <div class="expense-items" id="expense-items"></div>
    </section>

    <section class="card expense-save-card" style="margin-top:16px">
      <div>
        <strong>Salvar configuração</strong>
        <small>Os valores ficam vinculados ao seu usuário e podem ser alterados quando quiser.</small>
      </div>
      <button class="btn btn-primary" type="button" data-expense-action="save">
        Salvar meus gastos
      </button>
    </section>
  `;

  renderExpenseItems();
  recalculateExpenses();
}

function expenseMetric(label, id, hint) {
  return `
    <div class="card metric">
      <span class="metric-label">${label}</span>
      <strong class="metric-value" id="${id}">${expenseMoney.format(0)}</strong>
      <small class="metric-hint">${hint}</small>
    </div>
  `;
}

function renderExpenseItems() {
  const root = document.querySelector('#expense-items');
  if (!root || !expenseData) return;

  if (!expenseData.items.length) {
    root.innerHTML = `
      <div class="empty">
        <span class="empty-icon">◌</span>
        <strong>Nenhum item cadastrado</strong>
        <span>Clique em “Adicionar item” para incluir uma peça ou serviço.</span>
      </div>
    `;
    return;
  }

  root.innerHTML = expenseData.items.map((item, index) => `
    <article class="expense-item" data-expense-item="${expenseEscAttr(item.id || String(index))}">
      <div class="expense-item-head">
        <span class="expense-number">${index + 1}</span>
        <input class="input expense-name" data-expense-field="name"
          maxlength="80" value="${expenseEscAttr(item.name)}"
          aria-label="Nome do item">
        <button class="btn btn-small btn-danger" type="button"
          data-expense-action="remove" data-index="${index}">
          Excluir
        </button>
      </div>

      <div class="expense-item-grid">
        <div class="field">
          <label>Valor da peça / serviço</label>
          <input class="input" data-expense-field="value" type="number"
            min="0" step="0.01" inputmode="decimal"
            value="${expenseInputNumber(item.value || 0)}">
        </div>

        <div class="field">
          <label>Duração em km</label>
          <input class="input" data-expense-field="life_km" type="number"
            min="1" step="1" inputmode="numeric"
            value="${expenseInputNumber(item.life_km || 1)}">
        </div>

        <div class="expense-item-result">
          <span>Custo por km</span>
          <strong data-expense-cost-km>${expenseMoney.format(0)}</strong>
          <small data-expense-cost-trip>${expenseMoney.format(0)} no percurso</small>
        </div>
      </div>
    </article>
  `).join('');
}

function syncExpenseDataFromForm() {
  if (!expenseData) return;

  expenseData.profile.fuel_km_per_liter = expensePositive(
    document.querySelector('#expense-kml')?.value,
    expenseData.profile.fuel_km_per_liter || 35
  );
  expenseData.profile.fuel_price = expenseNonNegative(
    document.querySelector('#expense-fuel-price')?.value,
    expenseData.profile.fuel_price || 0
  );
  expenseData.profile.last_km = expenseNonNegative(
    document.querySelector('#expense-km')?.value,
    expenseData.profile.last_km || 0
  );

  document.querySelectorAll('[data-expense-item]').forEach((row, index) => {
    const item = expenseData.items[index];
    if (!item) return;

    item.name = String(
      row.querySelector('[data-expense-field="name"]')?.value || 'Item'
    ).trim().slice(0, 80) || 'Item';

    item.value = expenseNonNegative(
      row.querySelector('[data-expense-field="value"]')?.value,
      item.value || 0
    );

    item.life_km = expensePositive(
      row.querySelector('[data-expense-field="life_km"]')?.value,
      item.life_km || 1
    );
  });
}

function recalculateExpenses() {
  if (!expenseData) return;
  syncExpenseDataFromForm();

  const km = expenseData.profile.last_km;
  const kmPerLiter = expenseData.profile.fuel_km_per_liter;
  const fuelPrice = expenseData.profile.fuel_price;

  let maintenanceTrip = 0;
  let maintenancePerKm = 0;

  document.querySelectorAll('[data-expense-item]').forEach((row, index) => {
    const item = expenseData.items[index];
    if (!item) return;

    const costPerKm = item.life_km > 0 ? item.value / item.life_km : 0;
    const costTrip = costPerKm * km;

    maintenancePerKm += costPerKm;
    maintenanceTrip += costTrip;

    const perKm = row.querySelector('[data-expense-cost-km]');
    const trip = row.querySelector('[data-expense-cost-trip]');
    if (perKm) perKm.textContent = expenseMoney.format(costPerKm);
    if (trip) trip.textContent = `${expenseMoney.format(costTrip)} no percurso`;
  });

  const liters = kmPerLiter > 0 ? km / kmPerLiter : 0;
  const fuelTrip = liters * fuelPrice;
  const fuelPerKm = kmPerLiter > 0 ? fuelPrice / kmPerLiter : 0;
  const totalTrip = fuelTrip + maintenanceTrip;
  const totalPerKm = fuelPerKm + maintenancePerKm;

  expenseSetText('expense-fuel-total', expenseMoney.format(fuelTrip));
  expenseSetText('expense-maint-total', expenseMoney.format(maintenanceTrip));
  expenseSetText('expense-cost-km', expenseMoney.format(totalPerKm));
  expenseSetText('expense-total', expenseMoney.format(totalTrip));

  expenseSetText(
    'expense-total-hint',
    km > 0
      ? `Estimativa para ${expenseNumber.format(km)} km rodados.`
      : 'Digite os quilômetros rodados.'
  );

  expenseSetText(
    'expense-fuel-detail',
    km > 0
      ? `${expenseNumber.format(km)} km ÷ ${expenseNumber.format(kmPerLiter)} km/L = ${expenseNumber.format(liters)} L. Gasto de combustível: ${expenseMoney.format(fuelTrip)}.`
      : `Seu combustível custa aproximadamente ${expenseMoney.format(fuelPerKm)} por km.`
  );
}

document.addEventListener('input', (event) => {
  if (
    event.target.matches(
      '#expense-km, #expense-kml, #expense-fuel-price, [data-expense-field]'
    )
  ) {
    recalculateExpenses();
  }
});

document.addEventListener('click', async (event) => {
  const target = event.target.closest('[data-expense-action]');
  if (!target || !expenseData) return;

  const action = target.dataset.expenseAction;

  if (action === 'add') {
    syncExpenseDataFromForm();
    expenseData.items.push({
      id: `novo-${Date.now()}`,
      name: 'Novo item',
      value: 0,
      life_km: 10000
    });
    renderExpenseItems();
    recalculateExpenses();
    document.querySelector('#expense-items .expense-item:last-child .expense-name')?.focus();
    return;
  }

  if (action === 'remove') {
    syncExpenseDataFromForm();
    const index = Number(target.dataset.index);
    const item = expenseData.items[index];
    if (!item) return;
    if (!confirm(`Excluir "${item.name}" da sua lista de gastos?`)) return;

    expenseData.items.splice(index, 1);
    renderExpenseItems();
    recalculateExpenses();
    return;
  }

  if (action === 'save') {
    syncExpenseDataFromForm();
    recalculateExpenses();

    target.disabled = true;
    const oldText = target.textContent;
    target.textContent = 'Salvando...';

    try {
      expenseData = await expenseApi('/api/expenses', {
        method: 'PUT',
        body: {
          fuel_km_per_liter: expenseData.profile.fuel_km_per_liter,
          fuel_price: expenseData.profile.fuel_price,
          last_km: expenseData.profile.last_km,
          items: expenseData.items.map((item) => ({
            name: item.name,
            value: item.value,
            life_km: item.life_km
          }))
        }
      });
      renderExpensePage();
      expenseToast('Gastos salvos com sucesso.');
    } catch (error) {
      expenseToast(error.message, true);
    } finally {
      target.disabled = false;
      target.textContent = oldText;
    }
  }
});

async function expenseApi(path, options = {}) {
  const init = {
    method: options.method || 'GET',
    credentials: 'same-origin',
    headers: {}
  };

  if (options.body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(options.body);
  }

  const response = await fetch(path, init);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || 'Não foi possível concluir.');
  }
  return data;
}

function injectExpenseStyles() {
  if (document.querySelector('#cooperado-expense-styles')) return;

  const style = document.createElement('style');
  style.id = 'cooperado-expense-styles';
  style.textContent = `
    .expense-hero{
      display:flex;
      align-items:center;
      justify-content:space-between;
      gap:22px;
      padding:22px;
      color:#fff;
      background:linear-gradient(135deg,#5b2fa9 0%,#7a49c7 100%);
      border:none;
      overflow:hidden;
      position:relative;
    }
    .expense-hero::after{
      content:"";
      position:absolute;
      width:180px;
      height:180px;
      border-radius:50%;
      right:-70px;
      top:-90px;
      background:rgba(255,255,255,.08);
    }
    .expense-hero-copy,.expense-km-box{position:relative;z-index:1}
    .expense-hero .eyebrow,.expense-hero p{color:rgba(255,255,255,.8)}
    .expense-total{
      font-size:clamp(34px,8vw,52px);
      line-height:1;
      font-weight:850;
      letter-spacing:-.04em;
      margin:8px 0 10px;
    }
    .expense-km-box{
      min-width:245px;
      padding:15px;
      border-radius:16px;
      background:rgba(255,255,255,.12);
      border:1px solid rgba(255,255,255,.18);
      backdrop-filter:blur(8px);
    }
    .expense-km-box label{
      display:block;
      font-size:12px;
      font-weight:800;
      margin-bottom:8px;
    }
    .expense-km-entry{
      display:flex;
      align-items:center;
      gap:8px;
    }
    .expense-km-entry span{font-weight:800}
    .expense-km-input{
      font-size:22px!important;
      font-weight:850!important;
      text-align:center;
      min-width:0;
    }
    .expense-items{
      display:grid;
      gap:12px;
      margin-top:14px;
    }
    .expense-item{
      border:1px solid var(--border,#e4e4e7);
      border-radius:16px;
      padding:14px;
      background:#fff;
    }
    .expense-item-head{
      display:grid;
      grid-template-columns:34px minmax(0,1fr) auto;
      gap:10px;
      align-items:center;
      margin-bottom:12px;
    }
    .expense-number{
      width:30px;
      height:30px;
      border-radius:10px;
      display:grid;
      place-items:center;
      background:#f1ebfb;
      color:#6f3cc3;
      font-weight:850;
      font-size:12px;
    }
    .expense-name{font-weight:750}
    .expense-item-grid{
      display:grid;
      grid-template-columns:1fr 1fr minmax(160px,.8fr);
      gap:12px;
      align-items:end;
    }
    .expense-item-result{
      min-height:67px;
      padding:10px 12px;
      border-radius:12px;
      background:#f7f5fb;
      display:flex;
      flex-direction:column;
      justify-content:center;
    }
    .expense-item-result span,
    .expense-item-result small{
      color:#6b7280;
      font-size:11px;
    }
    .expense-item-result strong{
      margin:2px 0;
      font-size:18px;
    }
    .expense-formula{margin-top:10px}
    .expense-title-row{gap:12px}
    .expense-save-card{
      display:flex;
      align-items:center;
      justify-content:space-between;
      gap:16px;
    }
    .expense-save-card>div{
      display:flex;
      flex-direction:column;
      gap:3px;
    }
    .expense-save-card small{color:#71717a}
    @media(max-width:700px){
      .expense-hero{
        align-items:stretch;
        flex-direction:column;
      }
      .expense-km-box{
        width:100%;
        min-width:0;
      }
      .expense-item-grid{
        grid-template-columns:1fr 1fr;
      }
      .expense-item-result{
        grid-column:1/-1;
      }
      .expense-item-head{
        grid-template-columns:30px minmax(0,1fr);
      }
      .expense-item-head .btn-danger{
        grid-column:2;
        justify-self:end;
      }
      .expense-title-row{
        align-items:flex-start;
        flex-direction:column;
      }
      .expense-save-card{
        align-items:stretch;
        flex-direction:column;
      }
      .expense-save-card .btn{width:100%}
      .bottom-nav .nav-item{min-width:0}
      .bottom-nav .nav-item span:last-child{font-size:10px}
    }
  `;
  document.head.appendChild(style);
}

function expenseSetText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function expenseNonNegative(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function expensePositive(value, fallback = 1) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function expenseInputNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? String(number) : '0';
}

function expenseEsc(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  })[char]);
}

function expenseEscAttr(value) {
  return expenseEsc(value);
}

function expenseToast(message, error = false) {
  const toast = document.querySelector('#toast');
  if (!toast) return;
  toast.textContent = message;
  toast.className = `toast show${error ? ' error' : ''}`;
  clearTimeout(expenseToast.timer);
  expenseToast.timer = setTimeout(() => {
    toast.className = 'toast';
  }, 3000);
}
