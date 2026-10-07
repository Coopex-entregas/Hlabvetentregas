let expenseUser=null, expenseData=null, expenseMonthData=null, checking=false, timer=null;

const moneyFmt=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
const numFmt=new Intl.NumberFormat('pt-BR',{maximumFractionDigits:2});

bootExpenses();

function bootExpenses(){
  injectStyles();
  const root=document.querySelector('#app');
  if(!root) return;
  const obs=new MutationObserver(()=>{clearTimeout(timer);timer=setTimeout(()=>{ensureNav();enhanceClosing();},100);});
  obs.observe(root,{childList:true,subtree:true});
  document.addEventListener('click',e=>{
    if(e.target.closest('[data-nav]')) document.querySelector('[data-expense-nav]')?.classList.remove('active');
  });
  ensureNav();
}

async function ensureNav(){
  const nav=document.querySelector('.bottom-nav');
  if(!nav||nav.querySelector('[data-expense-nav]')||checking) return;
  checking=true;
  try{
    const me=await xapi('/api/me');
    expenseUser=me.user;
    if(expenseUser?.role!=='cooperado') return;
    const b=document.createElement('button');
    b.className='nav-item'; b.type='button'; b.dataset.expenseNav='1';
    b.innerHTML='<span class="nav-icon">🏍</span><span>Gastos</span>';
    b.addEventListener('click',openExpenses);
    nav.appendChild(b);
    nav.style.setProperty('--nav-count',nav.querySelectorAll('.nav-item').length);
  }catch{}finally{checking=false;}
}

async function openExpenses(){
  const page=document.querySelector('#page'); if(!page) return;
  document.querySelectorAll('[data-nav]').forEach(b=>b.classList.remove('active'));
  document.querySelector('[data-expense-nav]')?.classList.add('active');
  page.innerHTML='<div class="loading"><span class="spinner"></span><span>Carregando gastos...</span></div>';
  try{
    const month=today().slice(0,7);
    [expenseData,expenseMonthData]=await Promise.all([xapi('/api/expenses'),xapi(`/api/expenses/month?month=${month}`)]);
    render(month);
  }catch(e){page.innerHTML=`<div class="notice notice-danger">${esc(e.message)}</div>`;}
}

function render(month){
  const page=document.querySelector('#page'); if(!page) return;
  const p=expenseData.profile||{};
  page.innerHTML=`
    <div class="page-head"><div><h1>Gastos do cooperado</h1><p>O km sempre começa em zero. Só entra no mês quando você salvar o percurso.</p></div><span class="badge badge-success">Privado</span></div>

    <section class="card ex-hero">
      <div><span class="eyebrow">SIMULAÇÃO DO PERCURSO</span><div class="ex-total" id="ex-total">${moneyFmt.format(0)}</div><p id="ex-hint">Digite os quilômetros rodados.</p></div>
      <div class="ex-box">
        <div class="field"><label>Data do percurso</label><input class="input" id="ex-date" type="date" value="${today()}"></div>
        <label>Quantos km você rodou?</label>
        <div class="ex-km"><input class="input" id="ex-km" type="number" min="0" step="0.1" value="0"><span>km</span></div>
        <button class="btn btn-white btn-block" data-ex="save-entry" style="margin-top:10px">Salvar percurso no mês</button>
        <small>Se salvar a mesma data novamente, atualiza aquele dia e não duplica.</small>
      </div>
    </section>

    <div class="grid grid-3" style="margin-top:14px">
      ${metric('Combustível','ex-fuel','Nesta simulação')}
      ${metric('Manutenção','ex-maint','Desgaste proporcional')}
      ${metric('Custo por km','ex-km-cost','Combustível + manutenção')}
    </div>

    ${monthSummary(month)}

    <section class="card" style="margin-top:16px">
      <div class="card-title"><div><h2>Combustível</h2><small>Esses valores ficam salvos.</small></div><span class="badge">Configuração</span></div>
      <div class="form-grid">
        <div class="field"><label>Quantos km sua moto faz com 1 litro?</label><input class="input" id="ex-kml" type="number" min="0.1" step="0.1" value="${n(p.fuel_km_per_liter||35)}"></div>
        <div class="field"><label>Valor do litro</label><input class="input" id="ex-price" type="number" min="0" step="0.01" value="${n(p.fuel_price||0)}"></div>
      </div>
      <div class="notice" id="ex-formula" style="margin-top:10px"></div>
    </section>

    <section class="card" style="margin-top:16px">
      <div class="card-title"><div><h2>Peças e manutenção</h2><small>Valor e duração em km.</small></div><button class="btn btn-small btn-primary" data-ex="add">+ Adicionar item</button></div>
      <div id="ex-items" class="ex-items"></div>
    </section>

    <section class="card ex-save" style="margin-top:16px">
      <div><strong>Salvar configuração da moto</strong><small>Consumo, combustível, peças e durações ficam salvos. O km não.</small></div>
      <button class="btn btn-primary" data-ex="save-settings">Salvar configuração</button>
    </section>

    <section class="card" style="margin-top:16px">
      <div class="card-title"><div><h2>Histórico de percursos</h2><small>Somente os salvos reduzem o bruto.</small></div><div class="field ex-month"><label>Mês</label><input class="input" id="ex-month" type="month" value="${month}"></div></div>
      <div id="ex-history">${historyHtml()}</div>
    </section>`;
  renderItems(); recalc();
}

function metric(label,id,hint){return `<div class="card metric"><span class="metric-label">${label}</span><strong class="metric-value" id="${id}">${moneyFmt.format(0)}</strong><small class="metric-hint">${hint}</small></div>`;}

function monthSummary(month){
  const s=expenseMonthData?.summary||{};
  return `<section class="card ex-month-sum" style="margin-top:16px">
    <div class="card-title"><div><h2>Resultado líquido do mês</h2><small>${monthLabel(month)} • só percursos salvos</small></div><span class="badge badge-success">${numFmt.format(s.km||0)} km</span></div>
    <div class="grid grid-3" style="margin-top:12px">
      <div class="ex-result"><span>Recebimento bruto</span><strong>${moneyFmt.format(s.gross_amount||0)}</strong><small>Fixo + extras</small></div>
      <div class="ex-result danger"><span>Gastos da moto</span><strong>− ${moneyFmt.format(s.total_cost||0)}</strong><small>${moneyFmt.format(s.fuel_cost||0)} combustível + ${moneyFmt.format(s.maintenance_cost||0)} manutenção</small></div>
      <div class="ex-result success"><span>Líquido estimado</span><strong>${moneyFmt.format(s.net_amount||0)}</strong><small>Bruto menos gastos</small></div>
    </div>
  </section>`;
}

function historyHtml(){
  const entries=expenseMonthData?.entries||[];
  if(!entries.length) return `<div class="empty"><span class="empty-icon">◌</span><strong>Nenhum percurso salvo</strong><span>Simule e clique em “Salvar percurso no mês”.</span></div>`;
  return `<div class="list">${entries.map(e=>`<div class="list-item ex-hist">
    <div class="list-main"><strong>${fmtDate(e.expense_date)}</strong><small>${numFmt.format(e.km)} km • combustível ${moneyFmt.format(e.fuel_cost)} • manutenção ${moneyFmt.format(e.maintenance_cost)}</small></div>
    <div class="list-actions"><div class="list-value"><strong>${moneyFmt.format(e.total_cost)}</strong><small>gasto</small></div>
      <button class="btn btn-small" data-ex="edit-entry" data-date="${e.expense_date}" data-km="${e.km}">Editar</button>
      <button class="btn btn-small btn-danger" data-ex="delete-entry" data-id="${escAttr(e.id)}">Excluir</button>
    </div></div>`).join('')}</div>`;
}

function renderItems(){
  const root=document.querySelector('#ex-items'); if(!root) return;
  root.innerHTML=expenseData.items.map((it,i)=>`<div class="ex-item">
    <div class="ex-item-head"><span class="ex-num">${i+1}</span><input class="input" data-f="name" value="${escAttr(it.name)}"><button class="btn btn-small btn-danger" data-ex="remove" data-index="${i}">Excluir</button></div>
    <div class="ex-grid">
      <div class="field"><label>Valor da peça / serviço</label><input class="input" data-f="value" type="number" min="0" step="0.01" value="${n(it.value||0)}"></div>
      <div class="field"><label>Duração em km</label><input class="input" data-f="life_km" type="number" min="1" step="1" value="${n(it.life_km||1)}"></div>
      <div class="ex-item-result"><span>Custo por km</span><strong data-cpk>${moneyFmt.format(0)}</strong><small data-trip>${moneyFmt.format(0)} na simulação</small></div>
    </div></div>`).join('');
}

function sync(){
  if(!expenseData) return;
  expenseData.profile.fuel_km_per_liter=pos(document.querySelector('#ex-kml')?.value,expenseData.profile.fuel_km_per_liter||35);
  expenseData.profile.fuel_price=nonneg(document.querySelector('#ex-price')?.value,expenseData.profile.fuel_price||0);
  document.querySelectorAll('.ex-item').forEach((row,i)=>{
    const it=expenseData.items[i]; if(!it) return;
    it.name=(row.querySelector('[data-f="name"]')?.value||'Item').trim().slice(0,80)||'Item';
    it.value=nonneg(row.querySelector('[data-f="value"]')?.value,it.value||0);
    it.life_km=pos(row.querySelector('[data-f="life_km"]')?.value,it.life_km||1);
  });
}

function recalc(){
  if(!expenseData) return; sync();
  const km=nonneg(document.querySelector('#ex-km')?.value,0), kml=expenseData.profile.fuel_km_per_liter, price=expenseData.profile.fuel_price;
  let maint=0, maintPK=0;
  document.querySelectorAll('.ex-item').forEach((row,i)=>{
    const it=expenseData.items[i]; const cpk=it.value/it.life_km, trip=cpk*km; maint+=trip; maintPK+=cpk;
    row.querySelector('[data-cpk]').textContent=moneyFmt.format(cpk);
    row.querySelector('[data-trip]').textContent=`${moneyFmt.format(trip)} na simulação`;
  });
  const liters=kml>0?km/kml:0, fuel=liters*price, fuelPK=kml>0?price/kml:0;
  setText('ex-fuel',moneyFmt.format(fuel)); setText('ex-maint',moneyFmt.format(maint)); setText('ex-km-cost',moneyFmt.format(fuelPK+maintPK)); setText('ex-total',moneyFmt.format(fuel+maint));
  setText('ex-hint',km>0?`Estimativa para ${numFmt.format(km)} km. Ainda não descontada do mês.`:'Digite os quilômetros rodados.');
  setText('ex-formula',km>0?`${numFmt.format(km)} km ÷ ${numFmt.format(kml)} km/L = ${numFmt.format(liters)} L. Combustível: ${moneyFmt.format(fuel)}.`:`Combustível por km: ${moneyFmt.format(fuelPK)}.`);
}

document.addEventListener('input',e=>{if(e.target.matches('#ex-km,#ex-kml,#ex-price,[data-f]')) recalc();});
document.addEventListener('change',e=>{if(e.target.id==='ex-month') loadMonth(e.target.value);});

document.addEventListener('click',async e=>{
  const t=e.target.closest('[data-ex]'); if(!t||!expenseData) return;
  const a=t.dataset.ex;

  if(a==='add'){sync();expenseData.items.push({id:`n-${Date.now()}`,name:'Novo item',value:0,life_km:10000});renderItems();recalc();return;}
  if(a==='remove'){sync();const i=Number(t.dataset.index),it=expenseData.items[i];if(it&&confirm(`Excluir "${it.name}"?`)){expenseData.items.splice(i,1);renderItems();recalc();}return;}
  if(a==='save-settings'){await saveSettings(t,true);return;}

  if(a==='save-entry'){
    const km=nonneg(document.querySelector('#ex-km')?.value,0), date=document.querySelector('#ex-date')?.value||today();
    if(km<=0){toast('Informe quantos km você rodou.',true);return;}
    t.disabled=true; const old=t.textContent; t.textContent='Salvando...';
    try{
      await saveSettings(null,false);
      const r=await xapi('/api/expenses/entries',{method:'POST',body:{expense_date:date,km}});
      document.querySelector('#ex-km').value='0'; recalc();
      await loadMonth((document.querySelector('#ex-month')?.value)||date.slice(0,7));
      toast(r.entry.updated?'Percurso do dia atualizado.':'Percurso salvo e descontado do bruto do mês.');
    }catch(err){toast(err.message,true);}finally{t.disabled=false;t.textContent=old;}
    return;
  }

  if(a==='edit-entry'){
    document.querySelector('#ex-date').value=t.dataset.date;
    document.querySelector('#ex-km').value=t.dataset.km; recalc(); window.scrollTo({top:0,behavior:'smooth'});
    toast('Lançamento carregado. Altere e salve novamente.'); return;
  }

  if(a==='delete-entry'){
    if(!confirm('Excluir este percurso? O gasto sairá do total do mês.')) return;
    try{await xapi(`/api/expenses/entries/${t.dataset.id}`,{method:'DELETE'});await loadMonth(document.querySelector('#ex-month')?.value||today().slice(0,7));toast('Percurso excluído e líquido recalculado.');}catch(err){toast(err.message,true);}
  }
});

async function saveSettings(btn,show=true){
  sync(); if(btn){btn.disabled=true;btn.dataset.old=btn.textContent;btn.textContent='Salvando...';}
  try{
    expenseData=await xapi('/api/expenses',{method:'PUT',body:{
      fuel_km_per_liter:expenseData.profile.fuel_km_per_liter,
      fuel_price:expenseData.profile.fuel_price,
      items:expenseData.items.map(i=>({name:i.name,value:i.value,life_km:i.life_km}))
    }});
    if(show){renderItems();recalc();toast('Configuração salva.');}
  }finally{if(btn){btn.disabled=false;btn.textContent=btn.dataset.old||'Salvar configuração';}}
}

async function loadMonth(month){
  try{
    expenseMonthData=await xapi(`/api/expenses/month?month=${month}`);
    document.querySelector('.ex-month-sum')?.replaceWith(htmlNode(monthSummary(month)));
    const h=document.querySelector('#ex-history'); if(h) h.innerHTML=historyHtml();
    const mi=document.querySelector('#ex-month'); if(mi) mi.value=month;
  }catch(e){toast(e.message,true);}
}

async function enhanceClosing(){
  const form=document.querySelector('#month-filter'), content=document.querySelector('#closing-content');
  if(!form||!content) return;
  try{
    if(!expenseUser){const me=await xapi('/api/me');expenseUser=me.user;}
    if(expenseUser?.role!=='cooperado') return;
    const month=form.querySelector('input[name="month"]')?.value; if(!month) return;
    const old=content.querySelector('[data-net-box]'); if(old?.dataset.month===month) return;
    const d=await xapi(`/api/expenses/month?month=${month}`); old?.remove();
    const sec=document.createElement('section');sec.className='card';sec.style.marginTop='16px';sec.dataset.netBox='1';sec.dataset.month=month;
    sec.innerHTML=`<div class="card-title"><div><h2>Resultado líquido</h2><small>Descontando os percursos salvos em Gastos.</small></div><span class="badge badge-success">${numFmt.format(d.summary.km||0)} km</span></div>
    <div class="grid grid-3" style="margin-top:12px">
      <div class="ex-result"><span>Bruto</span><strong>${moneyFmt.format(d.summary.gross_amount||0)}</strong></div>
      <div class="ex-result danger"><span>Gastos da moto</span><strong>− ${moneyFmt.format(d.summary.total_cost||0)}</strong></div>
      <div class="ex-result success"><span>Líquido estimado</span><strong>${moneyFmt.format(d.summary.net_amount||0)}</strong></div>
    </div>`;
    content.appendChild(sec);
  }catch{}
}

async function xapi(path,opt={}){
  const init={method:opt.method||'GET',credentials:'same-origin',headers:{}};
  if(opt.body!==undefined){init.headers['Content-Type']='application/json';init.body=JSON.stringify(opt.body);}
  const r=await fetch(path,init),d=await r.json().catch(()=>({})); if(!r.ok) throw new Error(d.error||'Não foi possível concluir.'); return d;
}

function injectStyles(){
  if(document.querySelector('#expense-v2-style')) return;
  const s=document.createElement('style');s.id='expense-v2-style';s.textContent=`
  .ex-hero{display:flex;justify-content:space-between;gap:20px;padding:22px;background:linear-gradient(135deg,#5b2fa9,#7a49c7);color:#fff;border:none}
  .ex-hero .eyebrow,.ex-hero p,.ex-box small{color:rgba(255,255,255,.8)} .ex-total{font-size:clamp(34px,8vw,52px);font-weight:850;letter-spacing:-.04em;margin:8px 0}
  .ex-box{min-width:280px;padding:15px;border-radius:16px;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.18)} .ex-box label{display:block;font-size:12px;font-weight:800;margin-bottom:8px}
  .ex-km{display:flex;align-items:center;gap:8px}.ex-km input{font-size:22px!important;font-weight:850;text-align:center}.ex-items{display:grid;gap:12px;margin-top:14px}
  .ex-item{border:1px solid #e5e7eb;border-radius:16px;padding:14px;background:#fff}.ex-item-head{display:grid;grid-template-columns:34px 1fr auto;gap:10px;align-items:center;margin-bottom:12px}.ex-num{width:30px;height:30px;border-radius:10px;display:grid;place-items:center;background:#f1ebfb;color:#6f3cc3;font-weight:850}
  .ex-grid{display:grid;grid-template-columns:1fr 1fr minmax(160px,.8fr);gap:12px;align-items:end}.ex-item-result{padding:10px 12px;border-radius:12px;background:#f7f5fb;display:flex;flex-direction:column}.ex-item-result span,.ex-item-result small,.ex-save small{font-size:11px;color:#6b7280}
  .ex-save{display:flex;justify-content:space-between;align-items:center;gap:16px}.ex-save>div{display:flex;flex-direction:column;gap:3px}.ex-month{min-width:150px}.ex-result{border:1px solid #e7e5e4;border-radius:14px;padding:14px;display:flex;flex-direction:column;gap:4px}.ex-result span{font-size:11px;font-weight:800;text-transform:uppercase;color:#71717a}.ex-result strong{font-size:23px}.ex-result small{color:#71717a}.ex-result.danger{background:#fff7f7;border-color:#fecaca}.ex-result.danger strong{color:#b91c1c}.ex-result.success{background:#f0fdf4;border-color:#bbf7d0}.ex-result.success strong{color:#15803d}
  @media(max-width:700px){.ex-hero{flex-direction:column}.ex-box{min-width:0;width:100%}.ex-grid{grid-template-columns:1fr 1fr}.ex-item-result{grid-column:1/-1}.ex-item-head{grid-template-columns:30px 1fr}.ex-item-head .btn-danger{grid-column:2;justify-self:end}.ex-save{flex-direction:column;align-items:stretch}.ex-month{width:100%}.ex-hist{flex-direction:column;align-items:stretch}}
  `;document.head.appendChild(s);
}
function setText(id,v){const e=document.getElementById(id);if(e)e.textContent=v;}
function nonneg(v,f=0){const x=Number(v);return Number.isFinite(x)&&x>=0?x:f;}
function pos(v,f=1){const x=Number(v);return Number.isFinite(x)&&x>0?x:f;}
function n(v){const x=Number(v);return Number.isFinite(x)?String(x):'0';}
function today(){return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Fortaleza',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
function fmtDate(v){return new Intl.DateTimeFormat('pt-BR',{timeZone:'UTC'}).format(new Date(`${v}T12:00:00Z`));}
function monthLabel(v){const [y,m]=v.split('-');return new Intl.DateTimeFormat('pt-BR',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(Date.UTC(+y,+m-1,1)));}
function esc(v){return String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
function escAttr(v){return esc(v);}
function toast(msg,error=false){const e=document.querySelector('#toast');if(!e)return;e.textContent=msg;e.className=`toast show${error?' error':''}`;clearTimeout(toast.t);toast.t=setTimeout(()=>e.className='toast',3000);}
function htmlNode(html){const t=document.createElement('template');t.innerHTML=html.trim();return t.content.firstElementChild;}
