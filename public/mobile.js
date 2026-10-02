// Telas paginadas no celular, mantendo os eventos do app.js.
const style = document.createElement('style');
style.textContent = `
@media(max-width:700px){
 html,body{min-width:0;overflow-x:hidden}
 body:has(.app-shell){height:100dvh;overflow:hidden}
 .app-shell{height:100dvh;min-height:0;display:flex;flex-direction:column}
 .topbar{height:58px;min-height:58px;padding:8px 12px;position:static}
 .topbar-title{font-size:14px}.topbar-subtitle{font-size:11px}
 .content{flex:1;min-height:0;width:100%;padding:10px 12px;overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;touch-action:pan-y}
 .bottom-nav{position:static;left:auto;right:auto;bottom:auto;transform:none;width:100%;margin:0;border-radius:0;flex-shrink:0;padding:6px 3px max(6px,env(safe-area-inset-bottom))}
 .nav-item{min-width:0;font-size:10px;padding:5px 0}.nav-icon{font-size:20px}
 .page-head{margin-bottom:8px}.page-head h1{font-size:21px}.page-head p{font-size:12px}
 .card{padding:12px;border-radius:16px;margin-top:0!important}
 .card-title{gap:6px;margin-bottom:10px}.card-title h2{font-size:16px}
 .hero-value{font-size:34px}.hero-card p{font-size:13px}
 .field{gap:4px;margin-bottom:9px}.field label{font-size:12px}
 .input,.select,.textarea{padding:9px;min-width:0;font-size:16px}
 .form-grid{gap:8px;grid-template-columns:1fr 1fr}
 .grid-3{grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}
 .metric{padding:10px;min-width:0}.metric-value{font-size:20px}
 .list-item{padding:10px 0;gap:6px;min-width:0}
 .list-main{min-width:0;overflow-wrap:anywhere}.list-main strong{font-size:13px}
 .list-main small{font-size:11px}.list-actions{flex-wrap:wrap;gap:5px}
 .toolbar{gap:8px}.notice{padding:9px;font-size:12px}
 .segmented{margin-bottom:8px!important}.btn{padding:9px 12px}
 .mobile-hidden{display:revert!important}
 .mobile-pager{display:flex;align-items:center;justify-content:space-between;gap:8px;
 padding:6px 12px;background:white;border-top:1px solid #e8e2ef;flex-shrink:0}
 .mobile-pager span{font-size:12px;color:#6031aa}
 .mobile-pager button{min-height:40px;border:0;border-radius:10px;
 background:#eee6fb;color:#6031aa;font-weight:700;padding:8px 12px}
 .mobile-pager button:disabled{opacity:.35}
 .modal{overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;touch-action:pan-y;width:calc(100vw - 20px);max-height:calc(100dvh - 20px);padding:14px}
}
`;
document.head.append(style);

// Exibe todos os blocos; somente o conteúdo central rola.
document.querySelectorAll('.mobile-hidden').forEach(element => {
  element.classList.remove('mobile-hidden');
});
document.querySelectorAll('.mobile-pager').forEach(element => element.remove());
