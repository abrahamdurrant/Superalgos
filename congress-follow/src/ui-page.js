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
.fld{margin:12px 0}
.fld label{display:block;font-size:12px;font-weight:600;margin-bottom:4px}
.fld .hint{color:var(--muted);font-size:12px;margin-top:3px}
input,select{font:inherit;padding:6px 9px;border-radius:7px;border:1px solid var(--line);background:var(--bg);color:var(--ink);width:100%}
input[type=checkbox]{width:auto;margin-right:7px}
.row{display:flex;gap:10px;flex-wrap:wrap}.row>*{flex:1;min-width:150px}
.danger-zone{border:1px solid var(--live);border-radius:8px;padding:11px;margin-top:14px;background:var(--livebg)}
.mini{font-size:12px;padding:3px 7px}
.ovr{width:88px;display:inline-block}
.dim{opacity:.55}
a.who{color:var(--accent);text-decoration:none;font-weight:600}
a.who:hover{text-decoration:underline}
.ds{display:flex;align-items:center;gap:7px;padding:4px 0;font-size:13px}
.ds .bad{color:var(--sell);font-size:12px}
</style></head><body>
<header>
  <h1>congress-follow</h1>
  <span id="mode" class="mode dry">checking…</span>
  <span id="acct" class="sub"></span>
  <span class="spacer"></span>
  <button id="poll">Fetch disclosures</button>
  <button id="prev">Preview filters</button>
  <button id="sync">Sync statuses</button>
  <button id="auto">Run automation</button>
  <button id="settings">Settings</button>
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
      <button data-tab="perf" aria-selected="false">Performance</button>
      <button data-tab="expl" aria-selected="false">Explore</button>
      <button data-tab="cfg" aria-selected="false">Following</button>
    </div>
    <div id="pos"></div><div id="flt" hidden></div><div id="perf" hidden></div>
    <div id="expl" hidden></div><div id="hist" hidden></div><div id="cfg" hidden></div>
  </section>
</main>
<dialog id="sdlg"><div class="dlg">
  <h3 style="margin:0 0 12px">Settings</h3>
  <div id="sbody"></div>
  <div class="actions" style="margin-top:16px;justify-content:flex-end">
    <button id="sc">Close</button><button id="ss" class="primary">Save</button></div>
</div></dialog>
<dialog id="dlg"><div class="dlg"><h3 id="dt" style="margin:0 0 8px"></h3><div id="db"></div>
<div class="actions" style="margin-top:14px;justify-content:flex-end">
<button id="dc">Cancel</button><button id="dok" class="primary">Confirm</button></div></div></dialog>

<script>
const TOKEN=${JSON.stringify(token)};
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const usd=n=>n==null?'—':'$'+Number(n).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
let STATE=null,LIVE=false,ACCOUNTS=[];

const api=(p,opt={})=>fetch(p+(p.includes('?')?'&':'?')+'token='+TOKEN,
  {...opt,headers:{'content-type':'application/json','x-cf-token':TOKEN}})
  .then(async r=>{const j=await r.json().catch(()=>({error:'Bad response'}));
    if(!r.ok){const e=new Error(j.error||r.status);Object.assign(e,j);throw e}return j});

function confirmDialog(title,html,okLabel){
  return new Promise(res=>{
    $('dt').textContent=title;$('db').innerHTML=html;$('dok').textContent=okLabel;
    $('dok').className=LIVE?'primary danger':'primary';
    const done=v=>{$('dlg').close();$('dok').onclick=null;$('dc').onclick=null;res(v)};
    $('dok').onclick=()=>done(true);$('dc').onclick=()=>done(false);
    $('dlg').showModal();
  });
}

function accountOptions(sel){
  return '<option value="">default</option>'+ACCOUNTS.map(a=>
    '<option value="'+esc(a.accountId)+'"'+(a.accountId===sel?' selected':'')+'>'+esc(a.accountType||a.accountId)+'</option>').join('');
}
function orderRows(list,withActions){
  if(!list.length)return '<div class="empty">Nothing here.</div>';
  return '<div class="wrap"><table><thead><tr><th>Trade</th><th>Size</th><th>Disclosure</th><th>Status</th>'+
    (withActions?'<th></th>':'')+'</tr></thead><tbody>'+list.map(o=>{
    const size=o.side==='BUY'?usd(o.notionalUsd):esc(o.sellMode||'full')+' position';
    return '<tr>'+
      '<td><span class="side '+esc(o.side)+'">'+esc(o.side)+'</span> <span class="tick">'+esc(o.ticker)+'</span>'+
      '<div class="sub">'+esc(o.politician||'')+' · '+esc(o.party||'?')+'/'+esc(o.chamber||'?')+'</div></td>'+
      '<td>'+size+'<div class="sub">reported '+esc(o.reportedRange||'?')+
        (o.sizeNote?'<br>'+esc(o.sizeNote):'')+
        (o.sizeOverrideUsd?'<br><b>override '+usd(o.sizeOverrideUsd)+'</b>':'')+'</div></td>'+
      '<td class="sub">traded '+esc(o.transactionDate)+'<br>disclosed '+esc(o.reportDate)+' · '+esc(o.lagDays)+'d lag</td>'+
      '<td><span class="pill">'+esc(o.status)+'</span>'+(o.lastDryRunAt?'<div class="sub">dry-run done</div>':'')+
        (o.submitError?'<div class="sub">'+esc(o.submitError.slice(0,60))+'</div>':'')+'</td>'+
      (withActions?'<td><div class="actions">'+
        '<input class="ovr mini" type="number" min="1" step="1" placeholder="size" data-id="'+esc(o.id)+'" value="'+(o.sizeOverrideUsd??'')+'">'+
        '<select class="acct mini" data-id="'+esc(o.id)+'">'+accountOptions(o.accountId)+'</select>'+
        '<button class="ap" data-id="'+esc(o.id)+'">Approve</button>'+
        '<button class="rj danger" data-id="'+esc(o.id)+'">Reject</button></div>'+
        '<div class="sub">'+esc(o.dataset||'')+(o.bucket?' · '+esc(o.bucket):'')+'</div></td>':'')+
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
  $('cfg').innerHTML=(s.following.length?'':'<div class="empty">Not following anyone yet. Use the Explore tab to add people.</div>')+
    '<div class="wrap"><table><thead><tr><th>Following</th><th>BioGuide ID</th><th>Weight</th><th></th></tr></thead><tbody>'+
    s.following.map(f=>'<tr><td><a href="#" class="who" data-who="'+esc(f.name||'')+'">'+esc(f.name||'—')+'</a></td>'+
      '<td class="tick">'+esc(f.bioGuideId||'—')+(f.bioGuideId?'':'<div class="sub">name match only</div>')+'</td>'+
      '<td>'+esc(f.weight)+'</td>'+
      '<td><button class="mini unfollow danger" data-n="'+esc(f.name||'')+'" data-id="'+esc(f.bioGuideId||'')+'">Unfollow</button></td></tr>').join('')+
    '</tbody></table></div><div class="sub" style="padding:10px 15px">'+
    'Sizing: <b>'+esc(s.settings?.sizing?.mode||'?')+'</b>'+
    (s.settings?.sizing?.mode==='mirror'?' against '+usd(s.settings.sizing.capitalUsd)+' capital':'')+
    (s.allocationsLoaded!=null?' · '+s.allocationsLoaded+' portfolios loaded':'')+'<br>'+
    'Max '+esc(s.guardrails.maxNotionalPerTrade)+'/trade · '+esc(s.guardrails.maxOrdersPerDay)+' orders/day · '+
    esc(s.guardrails.maxOpenPositions)+' positions · automation '+(s.settings?.automation?.enabled?'ON':'off')+'</div>';

  document.querySelectorAll('.ap').forEach(b=>b.onclick=()=>approve(b.dataset.id));
  document.querySelectorAll('.rj').forEach(b=>b.onclick=()=>reject(b.dataset.id));
  document.querySelectorAll('.unfollow').forEach(b=>b.onclick=()=>doUnfollow(b.dataset.n,b.dataset.id));
  document.querySelectorAll('.who').forEach(a=>a.onclick=ev=>{ev.preventDefault();showActor(a.dataset.who)});
  document.querySelectorAll('.ovr').forEach(i=>i.onchange=()=>amend(i.dataset.id,{sizeOverrideUsd:i.value?Number(i.value):null}));
  document.querySelectorAll('.acct').forEach(sl=>sl.onchange=()=>amend(sl.dataset.id,{accountId:sl.value||null}));
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

async function amend(id,patch){
  try{await api('/api/amend',{method:'POST',body:JSON.stringify({id,...patch})});await load()}
  catch(e){await confirmDialog('Could not amend','<p>'+esc(e.message)+'</p>','Close')}
}

function settingsForm(s){
  const z=s.settings, ds=s.datasetCatalog.map(d=>{
    const st=(s.datasetStatus||[]).find(x=>x.id===d.id);
    const on=z.datasets?.[d.id]===true;
    return '<div class="ds"><input type="checkbox" id="ds_'+d.id+'"'+(on?' checked':'')+
      (d.signalSource?'':' disabled')+'>'+
      '<label for="ds_'+d.id+'" style="margin:0;font-weight:500">'+esc(d.label)+'</label>'+
      '<span class="pill">'+esc(d.plan)+'</span>'+
      (d.signalSource?'':'<span class="sub">explore only — company data, nobody to follow</span>')+
      (st&&!st.ok?'<span class="bad">'+esc(st.error)+'</span>':'')+
      (st&&st.ok?'<span class="sub">'+st.count+' rows'+(st.truncated?' of '+st.total+' (newest kept)':'')+'</span>':'')+'</div>';
  }).join('');
  return '<div class="fld"><label>Sizing mode</label><select id="s_mode">'+
      ['mirror','fixed','tiered'].map(m=>'<option value="'+m+'"'+(z.sizing.mode===m?' selected':'')+'>'+
        (m==='mirror'?'Mirror their portfolio allocation':m==='fixed'?'Fixed amount per trade':'Tiered by disclosed size')+'</option>').join('')+
      '</select><div class="hint">Mirror: if they hold 8% of their portfolio in a stock, you commit 8% of your capital below.</div></div>'+
    '<div class="row"><div class="fld"><label>Capital base</label><input id="s_cap" type="number" min="0" value="'+esc(z.sizing.capitalUsd)+'">'+
      '<div class="hint">Allocation percentages apply to this.</div></div>'+
      '<div class="fld"><label>Min per trade</label><input id="s_min" type="number" min="0" value="'+esc(z.sizing.minNotionalUsd)+'"></div>'+
      '<div class="fld"><label>Max per trade</label><input id="s_max" type="number" min="0" value="'+esc(z.sizing.maxNotionalUsd)+'"></div></div>'+
    '<div class="fld"><label>Datasets</label>'+ds+
      '<button id="s_detect" class="mini" style="margin-top:8px">Detect what my plan covers</button>'+
      '<div class="hint">Probes every dataset and switches on exactly the ones your Quiver API plan '+
      'entitles. Run this after changing plans.</div></div>'+
    '<div class="fld"><label>Default account</label><select id="s_acct">'+accountOptions(z.routing?.defaultAccountId)+'</select></div>'+
    '<div class="fld"><label><input type="checkbox" id="s_auto"'+(z.automation?.enabled?' checked':'')+'>Enable automation</label>'+
      '<div class="hint">Polls and submits every order that passes the guardrails, with no click.</div></div>'+
    '<div class="fld"><label><input type="checkbox" id="s_gate"'+(z.automation?.requireProvenSubmitPath?' checked':'')+'>Require one successful manual order first</label>'+
      '<div class="hint">placeOrder has never run against real Public infrastructure. This keeps an unattended loop from being the first thing to try it.</div></div>'+
    '<div class="danger-zone"><label><input type="checkbox" id="s_dry"'+(s.dryRun?'':' checked')+
      (s.dryRunForcedByEnv?' disabled':'')+'><b>Live trading</b> — submit real orders with real money</label>'+
      (s.dryRunForcedByEnv?'<div class="hint">DRY_RUN is set in your environment or .env, which overrides this. Remove it there to enable.</div>'
        :'<div class="hint">Leave off to keep logging payloads without sending them.</div>')+'</div>';
}

async function openSettings(){
  $('sbody').innerHTML=settingsForm(STATE);
  $('ss').onclick=async()=>{
    const datasets={};STATE.datasetCatalog.forEach(d=>{if(d.signalSource)datasets[d.id]=$('ds_'+d.id).checked});
    const goingLive=$('s_dry').checked&&STATE.dryRun;
    if(goingLive){
      $('sdlg').close();
      const ok=await confirmDialog('Turn on live trading',
        '<p style="color:var(--live)"><b>Approvals will place real orders in your account.</b></p>'+
        '<p class="sub">placeOrder has not yet been verified against real Public infrastructure. Consider making your first live order a small one on a liquid ticker during market hours, and checking the Public app straight after.</p>',
        'Enable live trading');
      if(!ok){$('sdlg').showModal();return}
    }
    try{
      await api('/api/settings',{method:'POST',body:JSON.stringify({
        dryRun:!$('s_dry').checked,
        datasets,
        sizing:{mode:$('s_mode').value,capitalUsd:Number($('s_cap').value),
                minNotionalUsd:Number($('s_min').value),maxNotionalUsd:Number($('s_max').value)},
        routing:{defaultAccountId:$('s_acct').value||null},
        automation:{enabled:$('s_auto').checked,requireProvenSubmitPath:$('s_gate').checked}
      })});
      $('sdlg').close();await load();
    }catch(e){await confirmDialog('Could not save','<p>'+esc(e.message)+'</p>','Close')}
  };
  $('s_detect').onclick=async()=>{
    $('s_detect').disabled=true;$('s_detect').textContent='Probing…';
    try{
      const r=await api('/api/detect-datasets',{method:'POST'});
      await load();
      $('sdlg').close();
      await confirmDialog('Plan check',
        '<pre>'+esc(r.results.map(x=>(x.ok?'OK  ':'403 ')+x.label+(x.ok?'':'  — '+x.error)).join('\\n'))+'</pre>'+
        '<p class="sub">'+r.enabled.length+' dataset(s) enabled.</p>','Close');
      openSettings();
    }catch(e){await confirmDialog('Probe failed','<p>'+esc(e.message)+'</p>','Close')}
    finally{if($('s_detect')){$('s_detect').disabled=false;$('s_detect').textContent='Detect what my plan covers'}}
  };
  $('sc').onclick=()=>$('sdlg').close();
  $('sdlg').showModal();
}

async function load(){
  STATE=await api('/api/state');
  try{ACCOUNTS=(await api('/api/accounts')).accounts||[]}catch{ACCOUNTS=[]}
  render();
}

$('refresh').onclick=load;
$('settings').onclick=openSettings;
$('auto').onclick=async()=>{
  const on=STATE.settings?.automation?.enabled;
  if(!on){await confirmDialog('Automation is off','<p class="sub">Enable it in Settings first.</p>','Close');return}
  if(LIVE&&!await confirmDialog('Run automation now',
    '<p style="color:var(--live)"><b>This submits every queued order that passes the guardrails, with real money.</b></p>','Run'))return;
  $('auto').disabled=true;
  try{
    const r=await api('/api/automate',{method:'POST'});await load();
    await confirmDialog('Automation',r.ran
      ?'<p>Queued '+r.queued+'. Submitted '+r.results.filter(x=>x.ok).length+', blocked '+r.results.filter(x=>!x.ok).length+'.</p>'+
        (r.results.filter(x=>!x.ok).length?'<pre>'+esc(r.results.filter(x=>!x.ok).map(x=>x.ticker+': '+x.error).join('\\n'))+'</pre>':'')
      :'<p class="sub">'+esc(r.reason)+'</p>','Close');
  }catch(e){await confirmDialog('Failed','<p>'+esc(e.message)+'</p>','Close')}
  finally{$('auto').disabled=false}
};
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

const pct=v=>v==null?'—':(v>=0?'+':'')+v.toFixed(1)+'%';

let PERF_SORT='year', PERF_MIN=3, PERF_GROUP='actor';

async function loadPerf(){
  $('perf').innerHTML='<div class="empty">Loading…</div>';
  try{
    const p=await api('/api/performance',{method:'POST',
      body:JSON.stringify({groupBy:PERF_GROUP,sortBy:PERF_SORT,minTrades:PERF_MIN})});
    const hdr=w=>w===PERF_SORT?' style="background:var(--bg);font-weight:700"':'';
    const rows=p.sources.slice(0,40).map((s,i)=>{
      if(!s.measurable) return '<tr class="dim"><td>'+esc(s.key)+'</td><td>'+s.windows.all.trades+
        '</td><td colspan="6" class="sub">no return data for this source</td></tr>';
      const rankNo=s.thinSample?'':'<b>'+(i+1)+'.</b> ';
      return '<tr'+(s.thinSample?' class="dim"':'')+'><td>'+rankNo+
        '<a href="#" class="who" data-who="'+esc(s.key)+'">'+esc(s.key)+'</a>'+
        '<div class="sub">'+esc(s.dataset||'')+
        (s.thinSample?' · only '+s.windows[PERF_SORT==='excess'?'year':PERF_SORT].coverage+' measured trade(s), ranked below':'')+
        '</div></td><td>'+s.windows.all.trades+'</td>'+
        ['day','month','year','all'].map(w=>'<td'+hdr(w)+'>'+pct(s.windows[w].avgReturnPct)+'</td>').join('')+
        '<td>'+pct(s.windows.all.avgExcessVsSpyPct)+'</td>'+
        '<td><input class="alloc mini" type="number" min="0" step="100" placeholder="capital" data-key="actor:'+esc(String(s.key).toLowerCase())+'" '+
          'value="'+esc(p.allocations['actor:'+String(s.key).toLowerCase()]?.capitalUsd??'')+'">'+
          '<select class="allocacct mini" data-key="actor:'+esc(String(s.key).toLowerCase())+'">'+
          accountOptions(p.allocations['actor:'+String(s.key).toLowerCase()]?.accountId)+'</select></td></tr>';
    }).join('');
    $('perf').innerHTML=
      '<div class="err" style="background:var(--warnbg);color:var(--warn)"><b>Read this before using these numbers.</b><br>'+
      'These are <b>average returns per disclosed trade</b>, not portfolio returns. Quiver publishes a price change '+
      'and excess-vs-SPY per congressional trade; no endpoint provides a price history, so a true daily/monthly/annual '+
      'compounded return cannot be computed. They are unweighted by position size, and they measure the entry made by the filer, not yours '+
      '— you buy up to 45 days later. A source with one lucky trade can show a huge number, so anything under the minimum trade count is ranked below the rest. '+
      'Return data exists only for congress trading.</div>'+
      '<div class="fld" style="padding:10px 15px;display:flex;gap:10px;align-items:end;flex-wrap:wrap">'+
        '<div style="flex:0 0 200px"><label>Rank by</label><select id="p_sort">'+
          [['year','Best 365d return'],['all','Best all-time return'],['month','Best 30d return'],
           ['excess','Best vs SPY (365d)'],['trades','Most trades']].map(([v,l])=>
           '<option value="'+v+'"'+(v===PERF_SORT?' selected':'')+'>'+l+'</option>').join('')+'</select></div>'+
        '<div style="flex:0 0 150px"><label>Min trades</label><input id="p_min" type="number" min="1" value="'+PERF_MIN+'"></div>'+
        '<div style="flex:0 0 160px"><label>Group by</label><select id="p_grp">'+
          '<option value="actor"'+(PERF_GROUP==='actor'?' selected':'')+'>Person</option>'+
          '<option value="dataset"'+(PERF_GROUP==='dataset'?' selected':'')+'>Dataset</option></select></div>'+
      '</div>'+
      '<div class="wrap"><table><thead><tr><th>Source</th><th>Trades</th><th>24h</th><th>30d</th><th>365d</th><th>All</th><th>vs SPY</th><th>Capital / account</th></tr></thead><tbody>'+
      rows+'</tbody></table></div>';
    $('p_sort').onchange=()=>{PERF_SORT=$('p_sort').value;loadPerf()};
    $('p_min').onchange=()=>{PERF_MIN=Math.max(1,Number($('p_min').value)||1);loadPerf()};
    $('p_grp').onchange=()=>{PERF_GROUP=$('p_grp').value;loadPerf()};
    document.querySelectorAll('.who').forEach(a=>a.onclick=ev=>{ev.preventDefault();showActor(a.dataset.who)});
    document.querySelectorAll('.alloc').forEach(i=>i.onchange=()=>saveAlloc(i.dataset.key,{capitalUsd:i.value?Number(i.value):null}));
    document.querySelectorAll('.allocacct').forEach(sl=>sl.onchange=()=>saveAlloc(sl.dataset.key,{accountId:sl.value||null}));
  }catch(e){$('perf').innerHTML='<div class="err">'+esc(e.message)+'</div>'}
}

function isFollowed(name,id){
  return (STATE.following||[]).some(f=>
    (id&&f.bioGuideId&&String(f.bioGuideId).toUpperCase()===String(id).toUpperCase())||
    (String(f.name||'').toLowerCase()===String(name||'').toLowerCase()));
}

async function doFollow(name,bioGuideId,btn){
  try{
    const r=await api('/api/follow',{method:'POST',body:JSON.stringify({name,bioGuideId:bioGuideId||null})});
    await load();
    if(btn){btn.textContent='Following';btn.disabled=true}
    if(r.alreadyFollowing)return;
    if(r.nameOnly)await confirmDialog('Following '+name,
      '<p class="sub">This feed carries no stable id for them, so matching is by name only. '+
      'Names are spelled inconsistently across filings and two people can share one, so this may match more or less than you intend.</p>','Close');
  }catch(e){await confirmDialog('Could not follow','<p>'+esc(e.message)+'</p>','Close')}
}

async function doUnfollow(name,bioGuideId){
  if(!await confirmDialog('Unfollow '+name,
    '<p class="sub">New disclosures from them stop being queued. Orders already pending are left alone.</p>','Unfollow'))return;
  try{await api('/api/unfollow',{method:'POST',body:JSON.stringify({name,bioGuideId:bioGuideId||null})});await load()}
  catch(e){await confirmDialog('Could not unfollow','<p>'+esc(e.message)+'</p>','Close')}
}

async function showActor(who){
  $('dt').textContent=who;
  $('db').innerHTML='<div class="empty">Loading trades…</div>';
  $('dok').textContent='Close';$('dok').className='primary';
  $('dok').onclick=()=>$('dlg').close();$('dc').onclick=()=>$('dlg').close();
  $('dlg').showModal();
  try{
    const r=await api('/api/actor',{method:'POST',body:JSON.stringify({actor:who})});
    if(!r.count){$('db').innerHTML='<p class="sub">No disclosed trades in the enabled datasets.</p>';return}
    $('db').innerHTML='<p class="sub">'+r.count+' disclosed trade(s), newest first. '+
      'Capital allocated: '+usd(r.allocation.capitalUsd)+' ('+esc(r.allocation.source)+')</p>'+
      '<p><button id="actfollow" class="mini'+(isFollowed(who,null)?'':' primary')+'">'+
      (isFollowed(who,null)?'Unfollow':'Follow')+' '+esc(who)+'</button></p>'+
      '<div class="wrap" style="max-height:52vh;overflow-y:auto"><table><thead><tr>'+
      '<th>Traded</th><th>Trade</th><th>Size</th><th>Since</th><th>Buy</th></tr></thead><tbody>'+
      r.trades.slice(0,80).map((t,i)=>'<tr><td class="sub">'+esc(t.transactionDate||'?')+
        '<div class="sub">filed '+esc(t.reportDate||'?')+'</div></td>'+
        '<td><span class="side '+esc(t.side)+'">'+esc(t.side)+'</span> <span class="tick">'+esc(t.ticker||'—')+'</span></td>'+
        '<td class="sub">'+esc(t.range||'—')+'</td>'+
        '<td>'+(t.priceChangePct==null?'<span class="sub">—</span>':
          pct(Number(t.priceChangePct))+(t.excessVsSpyPct==null?'':'<div class="sub">vs SPY '+pct(Number(t.excessVsSpyPct))+'</div>'))+'</td>'+
        '<td>'+(t.ticker&&t.side==='BUY'?'<input class="mini" style="width:74px" id="wamt_'+i+'" type="number" min="1" placeholder="$"> '+
          '<button class="mini wbuy" data-i="'+i+'" data-t="'+esc(t.ticker)+'">Queue</button>':'')+'</td></tr>').join('')+
      '</tbody></table></div>';
    $('actfollow').onclick=async()=>{
      if(isFollowed(who,null)){await doUnfollow(who,null)}else{await doFollow(who,null,null)}
      $('dlg').close();
    };
    document.querySelectorAll('.wbuy').forEach(b=>b.onclick=async()=>{
      const amt=$('wamt_'+b.dataset.i).value;
      if(!amt||Number(amt)<=0)return;
      try{
        await api('/api/manual-order',{method:'POST',body:JSON.stringify({
          ticker:b.dataset.t,notionalUsd:Number(amt),
          accountId:r.allocation.accountId||null,source:'actor:'+who})});
        b.textContent='Queued';b.disabled=true;await load();
      }catch(e){b.textContent='Failed'}
    });
  }catch(e){$('db').innerHTML='<div class="err">'+esc(e.message)+'</div>'}
}

async function saveAlloc(key,patch){
  const cur=STATE.settings.allocations?.[key]??{};
  const next={...cur,...patch};
  if(next.capitalUsd==null&&next.accountId==null){
    await api('/api/settings',{method:'POST',body:JSON.stringify({allocations:{[key]:null}})});
  }else{
    await api('/api/settings',{method:'POST',body:JSON.stringify({allocations:{[key]:next}})});
  }
  await load();
}

async function loadExplore(dsId){
  const cat=STATE.datasetCatalog;
  const sel='<select id="expl_ds">'+cat.map(d=>'<option value="'+esc(d.id)+'"'+(d.id===dsId?' selected':'')+'>'+
    esc(d.label)+(d.plan==='Hobbyist'?'':' — needs API '+esc(d.plan)+' plan')+'</option>').join('')+'</select>';
  $('expl').innerHTML='<div class="fld" style="padding:12px 15px">'+sel+
    ' <input id="expl_tk" class="mini" style="width:110px" placeholder="ticker (optional)"> '+
    '<button id="expl_go" class="mini primary">Load</button></div><div id="expl_rows"></div>';
  $('expl_ds').onchange=()=>loadExplore($('expl_ds').value);
  $('expl_go').onclick=async()=>{
    const id=$('expl_ds').value, tk=$('expl_tk').value.trim();
    $('expl_rows').innerHTML='<div class="empty">Loading…</div>';
    try{
      const r=await api('/api/browse',{method:'POST',body:JSON.stringify({dataset:id,ticker:tk||undefined})});
      $('expl_rows').innerHTML=r.rows.length?'<div class="wrap"><table><thead><tr><th>Trade</th><th>Size</th><th>Dates</th><th>Buy</th><th>Watchlist</th></tr></thead><tbody>'+
        r.rows.map((n,i)=>'<tr><td><span class="side '+(String(n.transaction).includes("Purchase")?"BUY":"SELL")+'">'+esc(n.transaction)+'</span> '+
          '<span class="tick">'+esc(n.ticker||'—')+'</span><div class="sub">'+esc(n.actor||'')+(n.chamber?' · '+esc(n.chamber):'')+'</div></td>'+
          '<td>'+esc(n.range||(n.amount?usd(n.amount):'—'))+'</td>'+
          '<td class="sub">traded '+esc(n.transactionDate||'?')+'<br>filed '+esc(n.reportDate||'?')+'</td>'+
          '<td>'+(n.ticker?'<input class="mini" style="width:80px" id="amt_'+i+'" type="number" min="1" placeholder="$"> '+
            '<select class="mini" id="acc_'+i+'">'+accountOptions(null)+'</select> '+
            '<button class="mini buyrow" data-i="'+i+'" data-t="'+esc(n.ticker)+'" data-s="'+esc(id)+'">Queue</button>':'')+'</td>'+
          '<td>'+(n.actor?'<button class="mini followrow" data-n="'+esc(n.actor)+'" data-id="'+esc(n.actorId||'')+'">'+
            (isFollowed(n.actor,n.actorId)?'Following':'Follow')+'</button>':'')+'</td></tr>').join('')+
        '</tbody></table></div>':'<div class="empty">No rows.</div>';
      document.querySelectorAll('.buyrow').forEach(b=>b.onclick=()=>queueBuy(b.dataset.t,$('amt_'+b.dataset.i).value,$('acc_'+b.dataset.i).value,b.dataset.s));
      document.querySelectorAll('.followrow').forEach(b=>b.onclick=()=>doFollow(b.dataset.n,b.dataset.id,b));
    }catch(e){
      const gated=e.planGated||/requires the Quiver API/.test(e.message||'');
      $('expl_rows').innerHTML=gated
        ? '<div class="err" style="background:var(--warnbg);color:var(--warn)">'+
          '<b>'+esc(e.message)+'</b><br>'+
          '<span class="sub">Your API plan is Hobbyist, which covers Congress, Senate, House, Trump trades, '+
          'government contracts and lobbying.<br><br>'+
          '<b>A Quiver web subscription is billed separately and does not grant API access.</b> '+
          'Holding web Trader does not unlock Trader datasets over the API — that is a separate '+
          '$75/mo API plan at api.quiverquant.com/pricing.</span></div>'
        : '<div class="err">'+esc(e.message)+'</div>';
    }
  };
  $('expl_go').click();
}

async function queueBuy(ticker,amount,accountId,source){
  if(!amount||Number(amount)<=0){await confirmDialog('Amount needed','<p class="sub">Enter a dollar amount first.</p>','Close');return}
  if(!await confirmDialog('Queue '+ticker,
    '<p>Queue a <b>BUY</b> of <b>'+esc(ticker)+'</b> for '+usd(Number(amount))+
    (accountId?' in '+esc(accountId):' in the default account')+'?</p>'+
    '<p class="sub">It lands as pending and still passes every guardrail when you approve it.</p>','Queue'))return;
  try{
    await api('/api/manual-order',{method:'POST',body:JSON.stringify({ticker,notionalUsd:Number(amount),accountId:accountId||null,source})});
    await load();
    await confirmDialog('Queued','<p class="sub">It is in the approval queue at the top of the page.</p>','Close');
  }catch(e){await confirmDialog('Could not queue','<p>'+esc(e.message)+'</p>','Close')}
}

document.querySelectorAll('.tabs button').forEach(b=>b.onclick=()=>{
  if(b.dataset.tab==='perf')loadPerf();
  if(b.dataset.tab==='expl')loadExplore(STATE.datasetCatalog[0]?.id);
  document.querySelectorAll('.tabs button').forEach(x=>x.setAttribute('aria-selected',x===b));
  ['pos','flt','perf','expl','hist','cfg'].forEach(id=>$(id).hidden=(id!==b.dataset.tab));});

load().catch(e=>{document.body.innerHTML='<main><section><div class="err">'+esc(e.message)+'</div></section></main>'});
setInterval(()=>load().catch(()=>{}),30000);
</script></body></html>`
}
