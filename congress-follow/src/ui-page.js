// Single self-contained page. No build step, no CDN, no external requests -
// this runs on a machine holding brokerage credentials.
export function renderPage (token) {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>congress-follow</title>
<style>
:root{
  --bg:#f6f7f9; --panel:#fff; --ink:#12151a; --muted:#6b7280; --line:#e3e6ea;
  --buy:#0a7d4f; --sell:#b3341f; --warn:#8a5a00; --warnbg:#fff6e0;
  --live:#a01b1b; --livebg:#fdeaea; --accent:#1f4fd8;
}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){
  --bg:#0f1216; --panel:#171b21; --ink:#e8ebef; --muted:#9aa4b2; --line:#262c34;
  --buy:#3ecf8e; --sell:#ff7a63; --warn:#e0b25a; --warnbg:#2a2214;
  --live:#ff6b6b; --livebg:#2b1414; --accent:#7aa2ff;
}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
header{padding:14px 18px;border-bottom:1px solid var(--line);display:flex;gap:14px;align-items:center;flex-wrap:wrap;background:var(--panel)}
h1{font-size:15px;margin:0;font-weight:650;letter-spacing:-.01em}
.mode{padding:3px 10px;border-radius:999px;font-weight:650;font-size:12px}
.mode.dry{background:var(--warnbg);color:var(--warn)}
.mode.live{background:var(--livebg);color:var(--live)}
.spacer{flex:1}
button{font:inherit;padding:6px 12px;border-radius:7px;border:1px solid var(--line);background:var(--panel);color:var(--ink);cursor:pointer}
button:hover{border-color:var(--accent)}
button:disabled{opacity:.5;cursor:not-allowed}
button.primary{background:var(--accent);border-color:var(--accent);color:#fff}
button.danger{color:var(--sell)}
main{padding:18px;max-width:1180px;margin:0 auto;display:grid;gap:18px}
section{background:var(--panel);border:1px solid var(--line);border-radius:11px;overflow:hidden}
section>h2{margin:0;padding:11px 15px;font-size:13px;font-weight:650;border-bottom:1px solid var(--line);display:flex;gap:9px;align-items:center}
.count{color:var(--muted);font-weight:450}
.wrap{overflow-x:auto}
table{width:100%;border-collapse:collapse;min-width:620px}
th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);padding:8px 15px;border-bottom:1px solid var(--line);font-weight:600}
td{padding:10px 15px;border-bottom:1px solid var(--line);vertical-align:top}
tr:last-child td{border-bottom:0}
.side{font-weight:700}.side.BUY{color:var(--buy)}.side.SELL{color:var(--sell)}
.tick{font-weight:650;font-variant-numeric:tabular-nums}
.sub{color:var(--muted);font-size:12px}
.empty{padding:26px 15px;color:var(--muted);text-align:center}
.pill{display:inline-block;padding:1px 8px;border-radius:999px;font-size:11px;border:1px solid var(--line);color:var(--muted)}
.err{background:var(--livebg);color:var(--live);padding:10px 15px;font-size:13px}
.actions{display:flex;gap:7px;flex-wrap:wrap}
dialog{border:1px solid var(--line);border-radius:11px;background:var(--panel);color:var(--ink);padding:0;max-width:560px;width:92vw}
dialog::backdrop{background:rgba(0,0,0,.45)}
.dlg{padding:17px}
pre{background:var(--bg);border:1px solid var(--line);border-radius:7px;padding:11px;overflow-x:auto;font-size:12px;margin:11px 0}
.tabs{display:flex;gap:5px;padding:9px 15px;border-bottom:1px solid var(--line)}
.tabs button{font-size:12px;padding:4px 11px}
.tabs button[aria-selected=true]{background:var(--accent);color:#fff;border-color:var(--accent)}
</style></head><body>
<header>
  <h1>congress-follow</h1>
  <span id="mode" class="mode dry">checking…</span>
  <span id="acct" class="sub"></span>
  <span class="spacer"></span>
  <button id="poll">Fetch disclosures</button>
  <button id="prev">Preview filters</button>
  <button id="sync">Sync statuses</button>
  <button id="refresh" class="primary">Refresh</button>
</header>
<main>
  <div id="banner"></div>
  <section><h2>Awaiting approval <span id="pc" class="count"></span></h2><div id="pending"></div></section>
  <section><h2>Needs review <span id="nc" class="count"></span></h2><div id="review"></div></section>
  <section>
    <div class="tabs">
      <button data-tab="pos" aria-selected="true">Positions</button>
      <button data-tab="flt" aria-selected="false">Filtered out</button>
      <button data-tab="hist" aria-selected="false">History</button>
      <button data-tab="cfg" aria-selected="false">Following</button>
    </div>
    <div id="pos"></div><div id="flt" hidden></div><div id="hist" hidden></div><div id="cfg" hidden></div>
  </section>
</main>
<dialog id="dlg"><div class="dlg"><h3 id="dt" style="margin:0 0 8px"></h3><div id="db"></div>
<div class="actions" style="margin-top:14px;justify-content:flex-end">
<button id="dc">Cancel</button><button id="dok" class="primary">Confirm</button></div></div></dialog>

<script>
const TOKEN=${JSON.stringify(token)};
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const usd=n=>n==null?'—':'$'+Number(n).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
let STATE=null,LIVE=false;

const api=(p,opt={})=>fetch(p+(p.includes('?')?'&':'?')+'token='+TOKEN,
  {...opt,headers:{'content-type':'application/json','x-cf-token':TOKEN}})
  .then(async r=>{const j=await r.json().catch(()=>({error:'Bad response'}));if(!r.ok)throw new Error(j.error||r.status);return j});

function confirmDialog(title,html,okLabel){
  return new Promise(res=>{
    $('dt').textContent=title;$('db').innerHTML=html;$('dok').textContent=okLabel;
    $('dok').className=LIVE?'primary danger':'primary';
    const done=v=>{$('dlg').close();$('dok').onclick=null;$('dc').onclick=null;res(v)};
    $('dok').onclick=()=>done(true);$('dc').onclick=()=>done(false);
    $('dlg').showModal();
  });
}

function orderRows(list,withActions){
  if(!list.length)return '<div class="empty">Nothing here.</div>';
  return '<div class="wrap"><table><thead><tr><th>Trade</th><th>Size</th><th>Disclosure</th><th>Status</th>'+
    (withActions?'<th></th>':'')+'</tr></thead><tbody>'+list.map(o=>{
    const size=o.side==='BUY'?usd(o.notionalUsd):esc(o.sellMode||'full')+' position';
    return '<tr>'+
      '<td><span class="side '+esc(o.side)+'">'+esc(o.side)+'</span> <span class="tick">'+esc(o.ticker)+'</span>'+
      '<div class="sub">'+esc(o.politician||'')+' · '+esc(o.party||'?')+'/'+esc(o.chamber||'?')+'</div></td>'+
      '<td>'+size+'<div class="sub">reported '+esc(o.reportedRange||'?')+'</div></td>'+
      '<td class="sub">traded '+esc(o.transactionDate)+'<br>disclosed '+esc(o.reportDate)+' · '+esc(o.lagDays)+'d lag</td>'+
      '<td><span class="pill">'+esc(o.status)+'</span>'+(o.lastDryRunAt?'<div class="sub">dry-run done</div>':'')+
        (o.submitError?'<div class="sub">'+esc(o.submitError.slice(0,60))+'</div>':'')+'</td>'+
      (withActions?'<td><div class="actions"><button class="ap" data-id="'+esc(o.id)+'">Approve</button>'+
        '<button class="rj danger" data-id="'+esc(o.id)+'">Reject</button></div></td>':'')+
    '</tr>';}).join('')+'</tbody></table></div>';
}

function render(){
  const s=STATE;LIVE=!s.dryRun;
  $('mode').textContent=s.dryRun?'DRY RUN — nothing is sent':'LIVE — real money';
  $('mode').className='mode '+(s.dryRun?'dry':'live');
  $('acct').textContent=s.accountId?('account '+s.accountId):'';
  $('banner').innerHTML=s.positionsError?'<section><div class="err"><b>Positions unavailable.</b> '+esc(s.positionsError.split('\\n')[0])+'<br><span class="sub">Approvals are blocked while positions cannot be read — this is deliberate.</span></div></section>':'';

  $('pc').textContent=s.pending.length;
  $('nc').textContent=s.needsReview.length;
  $('pending').innerHTML=orderRows(s.pending,true);
  $('review').innerHTML=orderRows(s.needsReview,false);

  const pos=s.positions?Object.entries(s.positions):[];
  $('pos').innerHTML=s.positionsError?'<div class="empty">Unavailable.</div>':
    (pos.length?'<div class="wrap"><table><thead><tr><th>Ticker</th><th>Shares</th></tr></thead><tbody>'+
      pos.map(([t,q])=>'<tr><td class="tick">'+esc(t)+'</td><td>'+esc(q)+'</td></tr>').join('')+
      '</tbody></table></div>':'<div class="empty">No open positions.</div>');

  $('hist').innerHTML=orderRows(s.history,false);
  $('cfg').innerHTML='<div class="wrap"><table><thead><tr><th>Following</th><th>BioGuide ID</th><th>Weight</th></tr></thead><tbody>'+
    s.following.map(f=>'<tr><td>'+esc(f.name||'—')+'</td><td class="tick">'+esc(f.bioGuideId||'—')+'</td><td>'+esc(f.weight)+'</td></tr>').join('')+
    '</tbody></table></div><div class="sub" style="padding:10px 15px">Max '+esc(s.guardrails.maxNotionalPerTrade)+'/trade · '+
    esc(s.guardrails.maxOrdersPerDay)+' orders/day · '+esc(s.guardrails.maxOpenPositions)+' positions</div>';

  document.querySelectorAll('.ap').forEach(b=>b.onclick=()=>approve(b.dataset.id));
  document.querySelectorAll('.rj').forEach(b=>b.onclick=()=>reject(b.dataset.id));
}

async function approve(id){
  const o=STATE.pending.find(x=>x.id===id);
  const size=o.side==='BUY'?usd(o.notionalUsd):(o.sellMode||'full')+' position';
  const warn=LIVE
    ? '<p style="color:var(--live)"><b>This will place a real order with real money.</b></p>'
    : '<p class="sub">DRY RUN: the payload is logged and nothing is sent. The order stays pending.</p>';
  const ok=await confirmDialog(
    (LIVE?'Place real order':'Dry-run')+': '+o.side+' '+o.ticker,
    warn+'<pre>'+esc(o.side)+' '+esc(o.ticker)+'\\n'+esc(size)+'\\nfollowing '+esc(o.politician)+'\\ndisclosed '+esc(o.reportDate)+' ('+esc(o.lagDays)+'d lag)</pre>',
    LIVE?'Place order':'Run dry');
  if(!ok)return;
  try{
    const r=await api('/api/approve',{method:'POST',body:JSON.stringify({id})});
    await load();
    if(r.dryRun)await confirmDialog('Dry run complete','<p class="sub">Nothing was sent. The order is still pending, so you can approve it for real later.</p><pre>'+esc(JSON.stringify(r.body,null,2))+'</pre>','Close');
  }catch(e){
    await confirmDialog('Not approved','<p>'+esc(e.message).replace(/\\n/g,'<br>')+'</p>','Close');
  }
}

async function reject(id){
  if(!await confirmDialog('Reject order','<p class="sub">It will not be placed, and this disclosure will not be queued again.</p>','Reject'))return;
  try{await api('/api/reject',{method:'POST',body:JSON.stringify({id})});await load()}
  catch(e){await confirmDialog('Failed','<p>'+esc(e.message)+'</p>','Close')}
}

async function load(){STATE=await api('/api/state');render()}

$('refresh').onclick=load;
$('poll').onclick=async()=>{$('poll').disabled=true;
  try{const r=await api('/api/poll',{method:'POST'});await load();
    await confirmDialog('Fetched','<p>'+r.total+' disclosures · <b>'+r.queued+' queued</b> · '+r.skipped+' filtered.</p>','Close')}
  catch(e){await confirmDialog('Failed','<p>'+esc(e.message)+'</p>','Close')}
  finally{$('poll').disabled=false}};
$('sync').onclick=async()=>{try{const r=await api('/api/sync',{method:'POST'});await load();
  await confirmDialog('Synced','<p>Refreshed '+r.refreshed+' order(s).</p>','Close')}catch(e){await confirmDialog('Failed','<p>'+esc(e.message)+'</p>','Close')}};
$('prev').onclick=async()=>{
  document.querySelector('[data-tab=flt]').click();
  $('flt').innerHTML='<div class="empty">Loading…</div>';
  try{
    const p=await api('/api/preview',{method:'POST'});
    const by={};for(const f of p.filtered){(by[f.reason]??=[]).push(f)}
    const groups=Object.entries(by).sort((a,b)=>b[1].length-a[1].length);
    $('flt').innerHTML='<div class="sub" style="padding:10px 15px">'+p.total+' disclosures · <b>'+p.wouldQueue.length+
      '</b> would queue · '+p.alreadyHandled.length+' already handled · '+p.filtered.length+' filtered</div>'+
      (groups.length?'<div class="wrap"><table><thead><tr><th>Filtered because</th><th>Count</th><th>Examples</th><th></th></tr></thead><tbody>'+
      groups.map(([r,items])=>'<tr><td>'+esc(r)+'</td><td>'+items.length+'</td><td class="sub">'+
        items.slice(0,3).map(i=>esc(i.politician)+' · '+esc(i.ticker||'—')).join('<br>')+'</td>'+
        '<td>'+(items[0].reconsiderable?'<span class="pill">re-checkable</span>':'<span class="pill">permanent</span>')+'</td></tr>').join('')+
      '</tbody></table></div>':'<div class="empty">Nothing filtered.</div>');
  }catch(e){$('flt').innerHTML='<div class="err">'+esc(e.message)+'</div>'}};

document.querySelectorAll('.tabs button').forEach(b=>b.onclick=()=>{
  document.querySelectorAll('.tabs button').forEach(x=>x.setAttribute('aria-selected',x===b));
  ['pos','flt','hist','cfg'].forEach(id=>$(id).hidden=(id!==b.dataset.tab));});

load().catch(e=>{document.body.innerHTML='<main><section><div class="err">'+esc(e.message)+'</div></section></main>'});
setInterval(()=>load().catch(()=>{}),30000);
</script></body></html>`
}
