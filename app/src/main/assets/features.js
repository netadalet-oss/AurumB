
/* ===== module: market summary ===== */

(()=>{
  if(globalThis.__aurumFinalMarketCore)return;globalThis.__aurumFinalMarketCore=true;
  const FM_CACHE='aurum.final.market.summary.v2',FM_CACHE_MS=10*60*1000;
  const FM_ISY='https://www.isyatirim.com.tr';
  const FM_URLS={
    news:FM_ISY+'/tr-tr/analiz/Haberler/Sayfalar/default.aspx',
    recs:FM_ISY+'/tr-tr/analiz/Sayfalar/is-yatirimin-onerileri.aspx',
    track:FM_ISY+'/tr-tr/analiz/hisse/Sayfalar/takip-listesi.aspx',
    analysis:FM_ISY+'/tr-tr/analiz/Sayfalar/default.aspx',
    funds:FM_ISY+'/tr-tr/urunler/Sayfalar/yatirim-fonlari.aspx',
    bigpara:'https://bigpara.hurriyet.com.tr/haberler/'
  };
  const FM_EXCLUDED=new Set(['BJKAS','FENER','GSRAY','TSPOR','AEFES','TBORG']);
  const fmClean=s=>String(s??'').replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim();
  const fmNorm=s=>fmClean(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const fmEsc=s=>fmClean(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmUniq=(a,key=x=>x)=>{const seen=new Set(),out=[];for(const x of a||[]){const k=key(x);if(!k||seen.has(k))continue;seen.add(k);out.push(x)}return out};
  const fmUniverse=()=>{try{return new Set(currentSymbols().map(x=>String(x).toUpperCase()))}catch{return new Set()}};
  function fmSave(v){try{localStorage.setItem(FM_CACHE,JSON.stringify(v))}catch{}}
  function fmLoad(){try{return JSON.parse(localStorage.getItem(FM_CACHE)||'null')}catch{return null}}
  async function fmText(url){const r=await fetch(url,{method:'GET',cache:'no-store',headers:{Accept:'text/html,application/xhtml+xml'}});if(!r.ok)throw new Error(`${new URL(url).hostname} HTTP ${r.status}`);return await r.text()}
  function fmDoc(t){return new DOMParser().parseFromString(String(t||''),'text/html')}
  function fmRows(doc){return [...doc.querySelectorAll('tr')].map(tr=>[...tr.querySelectorAll('th,td')].map(x=>fmClean(x.textContent))).filter(r=>r.length>1)}
  function fmIsFund(t){return /(yatirim fon|yatırım fon|\bfon\b|tefas|portfoy|portföy|para piyasasi|para piyasası|borclanma arac|borçlanma araç|emeklilik fon|fonmaster)/.test(fmNorm(t))}
  function fmCompanyMatchers(){const u=fmUniverse(),out=[];try{for(const x of state.companyDirectory?.values?.()||[]){const sym=String(x?.sym||'').toUpperCase();if(!u.has(sym)||FM_EXCLUDED.has(sym))continue;const name=fmNorm(x?.name||'').replace(/\b(a\.?s\.?|anonim|sirketi|şirketi|sanayi|ticaret|ve)\b/g,' ').replace(/\s+/g,' ').trim();if(name.length>=5)out.push({sym,name})}}catch{}return out}
  function fmStockMatch(text){const raw=fmClean(text),up=raw.toUpperCase(),u=fmUniverse();for(const tok of up.match(/[A-Z0-9]{2,8}/g)||[])if(u.has(tok)&&!FM_EXCLUDED.has(tok))return tok;const n=fmNorm(raw);for(const x of fmCompanyMatchers()){const parts=x.name.split(' ').filter(w=>w.length>=4).slice(0,3);if(parts.length&&parts.every(w=>n.includes(w)))return x.sym}return ''}
  function fmHeadlines(doc,source){
    const out=[],banned=/^(hakkımızda|hizmetler|ürünler|analiz|haberler|yatırım fonları|hisse senetleri|iş yatırım|iletişim|piyasa verileri|ana sayfa|borsa)$/i;
    for(const el of doc.querySelectorAll('h1,h2,h3,h4,a')){const t=fmClean(el.textContent);if(t.length<18||t.length>240||banned.test(t))continue;const n=fmNorm(t);if(/^(detay|devami|devamı|tumu|tümü|daha fazla)$/.test(n))continue;if([...FM_EXCLUDED].some(s=>new RegExp(`\\b${s}\\b`,'i').test(t)))continue;out.push({title:t,source})}
    return fmUniq(out,x=>fmNorm(x.title)).slice(0,80)
  }
  function fmClassify(items){const market=[],company=[],stock=[],fund=[];for(const x of items||[]){const n=fmNorm(x.title),sym=fmStockMatch(x.title);if(fmIsFund(x.title)){fund.push(x);continue}if(sym){stock.push({...x,sym});if(/(temettu|temettü|sermaye|bilanco|bilanço|finansal sonuc|finansal sonuç|kar payi|kâr payı|yatirim|yatırım|satis|satış|birlesme|birleşme|devral|ihale|sozlesme|sözleşme)/.test(n))company.push({...x,sym});continue}market.push(x)}return {market:market.slice(0,12),company:company.slice(0,10),stock:stock.slice(0,12),fund:fund.slice(0,10)}}
  function fmRecommendations(doc,limit=12){const u=fmUniverse(),out=[];for(const r of fmRows(doc)){const sym=fmClean(r[0]).toUpperCase();if(!u.has(sym)||FM_EXCLUDED.has(sym))continue;const rest=r.slice(1).filter(Boolean);if(rest.length<2)continue;out.push({sym,detail:rest.slice(0,8).join(' · '),source:'İş Yatırım'})}return fmUniq(out,x=>x.sym).slice(0,limit)}
  function fmFundResearch(doc){const out=[];for(const el of doc.querySelectorAll('h1,h2,h3,h4,a,p')){const t=fmClean(el.textContent);if(t.length<20||t.length>500||!fmIsFund(t))continue;out.push({title:t,source:'İş Yatırım'})}return fmUniq(out,x=>fmNorm(x.title)).slice(0,12)}
  function fmIsyMarket(doc){const wanted=/(XU100|BIST 100|VIOP|USD\/TRY|EUR\/TRY|EUR\/USD|BIST BANKA|ALTIN|BRENT|DOLAR|EURO)/i,out=[];for(const r of fmRows(doc)){const name=fmClean(r[0]);if(!wanted.test(name))continue;out.push({name,last:r[1]||'—',change:r[3]||r[2]||'—',source:'İş Yatırım'})}return fmUniq(out,x=>fmNorm(x.name)).slice(0,12)}
  const FM_QUOTES=[['BIST 100','XU100.IS'],['USD/TRY','TRY=X'],['EUR/TRY','EURTRY=X'],['GBP/TRY','GBPTRY=X'],['EUR/USD','EURUSD=X'],['Altın Ons (Vadeli)','GC=F'],['Gümüş','SI=F'],['Brent','BZ=F'],['WTI Petrol','CL=F']];
  async function fmYahooOne(name,symbol){let lastErr;for(const host of ['query1.finance.yahoo.com','query2.finance.yahoo.com']){try{const url=`https://${host}/v7/finance/quote?symbols=${encodeURIComponent(symbol)}`,r=globalThis.AurumNativeHTTP?.canHandle?.(url)?await globalThis.AurumNativeHTTP.request(url,{headers:{Accept:'application/json'}},12000):await fetch(url,{headers:{Accept:'application/json'},cache:'no-store'});if(!r.ok)throw new Error(`Yahoo HTTP ${r.status}`);const o=await r.json(),q=o?.quoteResponse?.result?.[0],last=Number(q?.regularMarketPrice),ch=Number(q?.regularMarketChangePercent);if(!Number.isFinite(last))throw new Error('Yahoo doğrudan fiyat yok');return {name,last:globalThis.AurumNumberFormat(last,2),change:Number.isFinite(ch)?`${ch>=0?'+':''}${globalThis.AurumNumberFormat(ch,2)}%`:'—',source:host.startsWith('query1')?'Yahoo Q1 · doğrudan':'Yahoo Q2 · doğrudan'}}catch(e){lastErr=e}}throw lastErr||new Error(`${name} alınamadı`)}
  async function fmYahooMarket(){const rs=await Promise.allSettled(FM_QUOTES.map(x=>fmYahooOne(...x)));return rs.filter(x=>x.status==='fulfilled').map(x=>x.value)}
  async function fmFetch(){
    const tasks={};for(const [k,u] of Object.entries(FM_URLS))tasks[k]=fmText(u);
    const entries=Object.entries(tasks),settled=await Promise.allSettled(entries.map(async([k,p])=>[k,await p])),docs={},errors=[];
    for(const r of settled){if(r.status==='fulfilled'){const [k,t]=r.value;docs[k]=fmDoc(t)}else errors.push(fmClean(r.reason?.message||r.reason))}
    let yahoo=[];try{yahoo=await fmYahooMarket()}catch(e){errors.push(fmClean(e?.message||e))}
    const isyHeads=docs.news?fmHeadlines(docs.news,'İş Yatırım'):[],bpHeads=docs.bigpara?fmHeadlines(docs.bigpara,'Bigpara'):[],allHeads=fmUniq([...isyHeads,...bpHeads],x=>fmNorm(x.title)),news=fmClassify(allHeads);
    const recDoc=docs.recs||docs.track;
    const isyMarket=recDoc?fmIsyMarket(recDoc):[];
    const market=fmUniq([...yahoo,...isyMarket],x=>fmNorm(x.name)).slice(0,16);
    const fundResearch=fmUniq([...(docs.analysis?fmFundResearch(docs.analysis):[]),...(docs.funds?fmFundResearch(docs.funds):[])],x=>fmNorm(x.title)).slice(0,12);
    return {updatedAt:new Date().toISOString(),market,marketNews:news.market,companyNews:news.company,stockNews:news.stock,stockRecs:recDoc?fmRecommendations(recDoc):[],fundNews:news.fund,fundResearch,errors};
  }
  const fmItems=(a,fn,empty)=>a?.length?a.map(fn).join(''):`<p class="muted">${fmEsc(empty)}</p>`;
  function fmNewsList(a,empty){return `<div class="card list">${fmItems(a,x=>`<div class="list-row"><div><strong>${fmEsc(x.title)}</strong><small>${fmEsc(x.sym?`${x.sym} · ${x.source}`:x.source)}</small></div></div>`,empty)}</div>`}
  function fmMarketList(a){return `<div class="card list">${fmItems(a,x=>`<div class="list-row"><strong>${fmEsc(x.name)}</strong><span>${fmEsc(x.last)} <small>${fmEsc(x.change)}</small><small>${fmEsc(x.source)}</small></span></div>`,'Güncel piyasa fiyatı alınamadı.')}</div>`}
  function fmRecList(a){return `<div class="card list">${fmItems(a,x=>`<div class="list-row"><div><strong class="symbol">${fmEsc(x.sym)}</strong><small>${fmEsc(x.detail)}</small></div><span>${fmEsc(x.source)}</span></div>`,'Geçerli hisse evreniyle eşleşen güncel öneri satırı bulunamadı.')}</div>`}
  function fmRenderData(d){return `<div class="section-head"><div class="section-title"><h2>Döviz · Altın · Para Piyasaları</h2></div><small>Uygulama içi piyasa verisi</small></div>${fmMarketList(d.market)}<div class="grid two-col"><div><div class="section-head"><div class="section-title"><h2>Piyasa Haberleri</h2></div></div>${fmNewsList(d.marketNews,'Güncel piyasa haberi ayrıştırılamadı.')}</div><div><div class="section-head"><div class="section-title"><h2>Şirket Haberleri</h2></div></div>${fmNewsList(d.companyNews,'Geçerli BIST evreniyle eşleşen güncel şirket haberi bulunamadı.')}</div><div><div class="section-head"><div class="section-title"><h2>Hisse Senedi Haberleri</h2></div></div>${fmNewsList(d.stockNews,'Geçerli BIST evreniyle eşleşen güncel hisse haberi bulunamadı.')}</div><div><div class="section-head"><div class="section-title"><h2>Hisse Senedi Önerileri</h2></div></div>${fmRecList(d.stockRecs)}</div><div><div class="section-head"><div class="section-title"><h2>Yatırım Fonu Haberleri</h2></div></div>${fmNewsList(d.fundNews,'Güncel yatırım fonu haberi ayrıştırılamadı.')}</div><div><div class="section-head"><div class="section-title"><h2>Fon Beklentileri ve Önerileri</h2></div></div>${fmNewsList(d.fundResearch,'Açık kaynaklarda güncel ve ayrıştırılabilir fon beklenti/öneri içeriği bulunamadı.')}</div></div><div class="card notice aurum-brief-notice" style="margin-top:14px"><b>Kaynaklar</b><small>İş Yatırım · Yahoo Finance · Bigpara · KAP eşleştirme</small>${d.errors?.length?`<small>${d.errors.length} kaynak yanıt vermedi.</small>`:''}<small>Son yenileme: ${fmEsc(new Date(d.updatedAt).toLocaleString('tr-TR'))}</small></div>`}
  globalThis.refreshAurumMarketSummary=async function(force=false){const host=document.querySelector('#aurumMarketSummaryBody');if(!host)return;const cached=fmLoad();if(cached)host.innerHTML=fmRenderData(cached);if(!force&&cached&&Date.now()-new Date(cached.updatedAt||0).getTime()<FM_CACHE_MS)return;if(globalThis.__aurumMarketSummaryLoading)return;globalThis.__aurumMarketSummaryLoading=true;try{if(!cached)host.innerHTML='<div class="card"><p class="muted">Piyasa özeti açık kaynaklardan uygulama içine yükleniyor…</p></div>';const d=await fmFetch();fmSave(d);if(state.page==='market'&&document.querySelector('#aurumMarketSummaryBody'))document.querySelector('#aurumMarketSummaryBody').innerHTML=fmRenderData(d)}catch(e){if(!cached&&host)host.innerHTML=`<div class="card notice"><b>Piyasa özeti yüklenemedi</b><p class="muted">${fmEsc(e?.message||e)}</p><button class="ghost-btn" type="button" onclick="refreshAurumMarketSummary(true)">Yeniden Dene</button></div>`}finally{globalThis.__aurumMarketSummaryLoading=false}};
  globalThis.marketPage=function(){const cached=fmLoad();return `<div class="actions" style="margin-bottom:12px"><button class="ghost-btn" type="button" onclick="goPage('overview')">← Genel Bakışa Dön</button><button class="gold-btn" type="button" onclick="runManualData('FULL')">Veriler ile Yenile</button></div><div class="section-head"><div class="section-title"><h2>Piyasa Özeti</h2></div><small>Haber · öneri · fon · döviz · altın</small></div><div id="aurumMarketSummaryBody">${cached?fmRenderData(cached):'<div class="card"><p class="muted">Piyasa özeti yükleniyor…</p></div>'}</div>`};
  globalThis.quickAccess=function(){return `<div class="section-head"><div class="section-title"><h2>Hızlı Erişim</h2></div></div><div class="quick-grid"><button class="quick-card" onclick="goPage('data')"><span class="quick-icon">▦</span><strong>Veriler</strong><small>Veri merkezi</small></button><button class="quick-card" onclick="goPage('criteria')"><span class="quick-icon">∑</span><strong>Kn Tabloları</strong><small>Kriter sıralamaları</small></button><button class="quick-card" onclick="goPage('history')"><span class="quick-icon">⌁</span><strong>K_Tarihsel</strong><small>Dönem sonuçları</small></button><button class="quick-card" onclick="goPage('market')"><span class="quick-icon">◫</span><strong>Piyasa Özeti</strong><small>Piyasa görünümü</small></button><button class="quick-card" onclick="goPage('ai')"><span class="quick-icon">✦</span><strong>Yapay Zekâ Merkezi</strong><small>Denetim ve aday model</small></button><button class="quick-card" onclick="goPage('settings')"><span class="quick-icon">⚙</span><strong>Ayarlar</strong><small>Kaynak ve otomasyon</small></button></div>`};
  try{quickAccess=globalThis.quickAccess}catch{}
  globalThis.overview=function(){const s=state.selection,avg=mean(s.map(x=>x.dayChange)),med=median(s.map(x=>x.dayChange)),evaluated=latestTargetRun(),q=mean(state.records.map(x=>x.quality)),lm=learningMomentum(),profiles=[...state.behaviorProfiles.values()];return `${quickAccess()}<div class="section-head"><div class="section-title"><h2>Sonuç ve Öğrenme Özeti</h2></div><small>Canlı sistem görünümü</small></div><div class="grid metrics">${metric('Aktif seçim',s.length,'S · Nihai liste')}${metric('Hedef isabet',evaluated?fmt(evaluated.metrics.precisionDual20*100,1)+'%':'—','Reel Top20 + ≥%'+state.settings.targetReturnPct)}${metric('Öğrenme puanı',fmt(lm.score,1)+'/100',lm.delta==null?'Yeni kanıt bekleniyor':`7 dönem değişim ${lm.delta>=0?'+':''}${fmt(lm.delta*100,1)} puan`,lm.delta>=0?'green':'red')}${metric('Davranış kapsaması',fmt((state.behaviorMemory.coverage||0)*100,1)+'%',`${profiles.length} hisse · 252 seans`)}${metric('DNA kapsaması',fmt((state.behaviorMemory.genomeCoverage||0)*100,1)+'%',`${GENOME_TRAIT_COUNT} özellik · K12`)}${metric('Ortalama günlük',pct(avg),'Seçili hisseler',avg>=0?'green':'red')}${metric('Medyan günlük',pct(med),'Seçili hisseler',med>=0?'green':'red')}${metric('Veri kalite',q?fmt(q,0)+'/100':'—',`${state.records.length} kayıt`)}${metric('Model',MODEL_VERSION,'Şampiyon–aday + 89 özellikli DNA')}</div><div class="section-head"><div class="section-title"><h2>Öğrenme disiplini</h2></div></div><div class="grid two-col"><div class="card gold-edge"><b class="gold">${state.performance.lastDecision||'BEKLEME'}</b><p class="muted">Yeni ağırlık veya davranış katkısı, yalnız ayrılmış ileri dönem doğrulamasında mevcut şampiyonu geçtiğinde etkinleşir.</p><button class="ghost-btn" onclick="goPage('learning')">Öğrenme ve Davranış Modülünü Aç</button></div><div class="card list">${Object.entries(state.sourceStats).map(([k,v])=>`<div class="list-row"><strong>${html(k)}</strong><span>${v} sembol</span></div>`).join('')||'<p class="muted">Bu oturumda kaynak çalıştırılmadı.</p>'}</div></div>`};
  try{overview=globalThis.overview}catch{}
})();

/* ===== module: İş Yatırım company card ===== */
'use strict';

(function installIsYatirimCompanyCardAdapter(){
  const SOURCE='ISYATIRIM_COMPANY_CARD';
  const BASE='https://www.isyatirim.com.tr/tr-tr/analiz/hisse/Sayfalar/sirket-karti.aspx?hisse=';
  const TTL_MS=24*60*60*1000,ERROR_TTL_MS=2*60*60*1000,REQUEST_GAP_MS=900;
  const CACHE_PREFIX='aurum.isyatirim.companyCard.v2.',HISTORY_PREFIX='aurum.isyatirim.companyCard.history.v1.';
  let lastRequestAt=0,active=false;
  const text=x=>String(x??'').replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim();
  const norm=x=>text(x).toLocaleLowerCase('tr-TR').replace(/[()]/g,'').replace(/[%]/g,' yüzde ').replace(/[^a-z0-9çğıöşü]+/gi,' ').trim();
  const num=x=>{if(x==null||x==='')return null;let s=text(x).replace(/mn\s*tl|milyon\s*tl|mntl|tl|usd|x/gi,'').replace(/\s/g,'').replace(/[^0-9,+\-.]/g,'');if(!s||s==='-'||s==='A/D')return null;if(s.includes(',')&&s.includes('.'))s=s.replace(/\./g,'').replace(',','.');else if(s.includes(','))s=s.replace(',','.');const n=Number(s);return Number.isFinite(n)?n:null;};
  const cacheKey=s=>CACHE_PREFIX+s,historyKey=s=>HISTORY_PREFIX+s;
  const readJson=(k,f=null)=>{try{return JSON.parse(localStorage.getItem(k)||'null')??f;}catch(_){return f;}};
  const writeJson=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v));}catch(_){}};
  const fresh=c=>c&&Date.now()-new Date(c.fetchedAt||0).getTime()<(c.status==='OK'?TTL_MS:ERROR_TTL_MS);
  async function throttle(){const wait=Math.max(0,REQUEST_GAP_MS-(Date.now()-lastRequestAt));if(wait)await new Promise(r=>setTimeout(r,wait));lastRequestAt=Date.now();}
  function between(body,start,end){const a=body.indexOf(start);if(a<0)return '';const b=end?body.indexOf(end,a+start.length):-1;return body.slice(a,b>a?b:undefined);}
  function valueIn(block,label){const safe=label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');const m=block.match(new RegExp(`${safe}\\s*(?:\\(%\\))?\\s*([+\\-]?[0-9][0-9.,]*)`,'i'));return m?num(m[1]):null;}
  function allRows(doc){return [...doc.querySelectorAll('tr')].map(tr=>[...tr.querySelectorAll('th,td')].map(td=>text(td.textContent)).filter(Boolean)).filter(r=>r.length>=2);}
  function findRowValue(rows,aliases){const wanted=aliases.map(norm);for(const r of rows){const k=norm(r[0]);if(wanted.some(a=>k===a||k.includes(a)))return r[1]??null;}return null;}
  function findNumbers(rows,label){const key=norm(label),r=rows.find(x=>norm(x[0]).includes(key));return r?r.slice(1).map(num).filter(Number.isFinite):[];}
  function sectionText(doc,heading){const wanted=norm(heading),heads=[...doc.querySelectorAll('h1,h2,h3,h4,h5,strong')],h=heads.find(x=>norm(x.textContent)===wanted||norm(x.textContent).includes(wanted));if(!h)return '';const out=[];let n=h.nextElementSibling,guard=0;while(n&&guard++<20){if(/^H[1-5]$/.test(n.tagName))break;const t=text(n.textContent);if(t)out.push(t);n=n.nextElementSibling;}return out.join(' ').slice(0,8000);}
  function extractRecommendation(body){const r=(body.match(/Hisse Önerisi\s+(AL|TUT|SAT|ÖNERİ YOK)/i)||[])[1]||null,t=(body.match(/Hedef Fiyat\s+([0-9.,]+)/i)||[])[1],u=(body.match(/Getiri Pot\s*%?\s*([+\-]?[0-9.,]+)/i)||[])[1],d=(body.match(/Son Öneri Tarihi\s+([0-9.]+)/i)||[])[1];return {recommendation:r?r.toUpperCase():null,recommendationDate:d||null,targetPrice:num(t),upsidePotentialPct:num(u)};}
  function parseHtml(sym,htmlText,url){
    const doc=new DOMParser().parseFromString(htmlText,'text/html'),body=text(doc.body?.innerText||'');
    if(!body||!body.toUpperCase().includes(sym))throw new Error('Şirket kartı sembol doğrulaması başarısız');
    const rows=allRows(doc),rec=extractRecommendation(body),cari=between(body,'Cari Değerler','Getiriler'),indices=between(body,'Dahil Olduğu Endekslerdeki Ağırlığı','Şirket Künyesi');
    const metrics={
      pe:valueIn(cari,'F/K'),pb:valueIn(cari,'PD/DD'),evEbitda:valueIn(cari,'FD/FAVÖK'),evSales:valueIn(cari,'FD/Satışlar'),
      foreignRatioPct:valueIn(cari,'Yabancı Oranı'),freeFloatPct:valueIn(cari,'Halka Açıklık Oranı'),marketCapMnTl:valueIn(cari,'Piyasa Değeri'),netDebtMnTl:valueIn(cari,'Net Borç'),
      averageVolumeMnUsd:valueIn(cari,'Ort Hacim'),roePct:valueIn(between(body,'Özet Finansal Göstergeler','Cari Değerler'),'ROE'),
      xu100WeightPct:valueIn(indices,'XU100'),xu50WeightPct:valueIn(indices,'XU050'),xu30WeightPct:valueIn(indices,'XU030')
    };
    const priceMove=findNumbers(rows,'Fiyat Hareketi'),volumeMove=findNumbers(rows,'Hacim Hareketi');
    const companyName=text(doc.querySelector('h1')?.textContent||'').replace(/Hisse Senedi.*$/i,'').trim()||null;
    const reportLink=[...doc.querySelectorAll('a[href]')].find(a=>/arastirma\.isyatirim\.com\.tr/i.test(a.href));
    return {status:'OK',source:SOURCE,symbol:sym,url,fetchedAt:new Date().toISOString(),companyName,
      recommendation:{...rec,theme:sectionText(doc,'Yatırım Teması'),catalysts:sectionText(doc,'Katalist'),valuation:sectionText(doc,'Değerleme'),risks:sectionText(doc,'Riskler')},metrics,
      periodMoves:{priceMin:priceMove[0]??null,priceMax:priceMove[1]??null,priceChange:priceMove[2]??null,volumeMin:volumeMove[0]??null,volumeMax:volumeMove[1]??null,volumeChange:volumeMove[2]??null},
      companyProfile:{title:findRowValue(rows,['Ünvanı','Unvanı']),foundedAt:findRowValue(rows,['Kuruluş']),activity:findRowValue(rows,['Faal Alanı','Faaliyet Alanı'])},
      sections:{forecasts:sectionText(doc,'Tahmin Güncellemeleri')||sectionText(doc,'Tahminler'),dividends:sectionText(doc,'Temettü Gerçekleşen')||sectionText(doc,'Temettüler'),financials:sectionText(doc,'Mali Tablo'),ratios:sectionText(doc,'Finansal Oranlar')},
      researchReportsUrl:reportLink?.href||null,rawEvidence:{rowCount:rows.length,textLength:htmlText.length}};
  }
  function updateHistory(sym,card){const old=readJson(historyKey(sym),[]),last=old[0];if(!last||last.sourceHashSha256!==card.sourceHashSha256){old.unshift({fetchedAt:card.fetchedAt,sourceHashSha256:card.sourceHashSha256,recommendation:card.recommendation?.recommendation||null,targetPrice:card.recommendation?.targetPrice??null,upsidePotentialPct:card.recommendation?.upsidePotentialPct??null,pe:card.metrics?.pe??null,pb:card.metrics?.pb??null});writeJson(historyKey(sym),old.slice(0,32));}return old.slice(0,32);}
  async function fetchCard(sym,{force=false}={}){
    sym=String(sym||'').trim().toUpperCase();if(!/^[A-Z0-9]{3,8}$/.test(sym))throw new Error('Geçersiz hisse kodu');const cached=readJson(cacheKey(sym));if(!force&&fresh(cached))return cached;
    await throttle();const url=BASE+encodeURIComponent(sym);
    try{const res=await fetchWithTimeout(url,{headers:{Accept:'text/html,application/xhtml+xml','Accept-Language':'tr-TR,tr;q=0.9','Accept-Encoding':'identity',Referer:'https://www.isyatirim.com.tr/tr-tr/analiz/hisse/Sayfalar/default.aspx','Cache-Control':'no-cache'}},6500);if(!res.ok)throw new Error(`HTTP ${res.status}`);const htmlText=await res.text(),parsed=parseHtml(sym,htmlText,url);if(typeof sha256Hex==='function')parsed.sourceHashSha256=await sha256Hex(htmlText);parsed.history=updateHistory(sym,parsed);writeJson(cacheKey(sym),parsed);return parsed;}
    catch(e){const failed={status:'ERROR',source:SOURCE,symbol:sym,url,fetchedAt:new Date().toISOString(),error:e.message||String(e)};writeJson(cacheKey(sym),failed);if(cached?.status==='OK')return {...cached,stale:true,lastRefreshError:failed.error};throw e;}
  }
  const firstFinite=(obj,keys)=>{for(const k of keys){const raw=obj?.[k];if(raw===null||raw===undefined||(typeof raw==='string'&&!raw.trim()))continue;const n=Number(raw);if(Number.isFinite(n))return n;}return null;};
  const diff=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)?a-b:null;
  const relAgreement=(a,b)=>{if(!Number.isFinite(a)||!Number.isFinite(b))return null;const d=Math.abs(a-b)/Math.max(Math.abs(a),Math.abs(b),1e-9);return Math.max(0,1-d);};
  function attach(rec,card){
    if(!rec||card?.status!=='OK')return rec;const f=rec.fundamentals||(rec.fundamentals={}),m=card.metrics||{},r=card.recommendation||{};
    const before={pe:firstFinite(f,['pe','fk','priceEarnings']),pb:firstFinite(f,['pb','pdDd','priceBook']),evEbitda:firstFinite(f,['evEbitda','fdFavok']),roe:firstFinite(f,['roe','roePct']),marketCap:firstFinite(f,['marketCap','marketCapMnTl'])};
    const comparisons={peDifference:diff(before.pe,m.pe),pbDifference:diff(before.pb,m.pb),evEbitdaDifference:diff(before.evEbitda,m.evEbitda),roeDifference:diff(before.roe,m.roePct),marketCapDifference:diff(before.marketCap,m.marketCapMnTl)};
    const agreements=[relAgreement(before.pe,m.pe),relAgreement(before.pb,m.pb),relAgreement(before.evEbitda,m.evEbitda),relAgreement(before.roe,m.roePct),relAgreement(before.marketCap,m.marketCapMnTl)].filter(Number.isFinite);
    const assignMissing=(keys,value)=>{if(value===null||value===undefined||(typeof value==='string'&&!value.trim())||!Number.isFinite(Number(value)))return;const n=Number(value),zeroInvalid=keys.some(k=>['pe','fk','priceEarnings','pb','pdDd','priceBook','evEbitda','fdFavok','roe','roePct','marketCap','marketCapMnTl','freeFloat','freeFloatPct'].includes(k));if(zeroInvalid&&n===0)return;for(const k of keys){const cur=f[k],curMissing=cur===null||cur===undefined||(typeof cur==='string'&&!cur.trim())||!Number.isFinite(Number(cur))||(zeroInvalid&&Number(cur)===0);if(curMissing)f[k]=n;}};
    assignMissing(['pe','fk','priceEarnings'],m.pe);assignMissing(['pb','pdDd','priceBook'],m.pb);assignMissing(['evEbitda','fdFavok'],m.evEbitda);assignMissing(['evSales','fdSales'],m.evSales);assignMissing(['roe','roePct'],m.roePct);assignMissing(['marketCap','marketCapMnTl'],m.marketCapMnTl);assignMissing(['netDebt','netDebtMnTl'],m.netDebtMnTl);assignMissing(['freeFloat','freeFloatPct'],m.freeFloatPct);assignMissing(['foreignRatio','foreignRatioPct'],m.foreignRatioPct);
    const derivedEv=Number.isFinite(Number(m.marketCapMnTl))&&Number.isFinite(Number(m.netDebtMnTl))?Number(m.marketCapMnTl)+Number(m.netDebtMnTl):null;assignMissing(['enterpriseValue','fd'],derivedEv);const derivedEbitda=Number.isFinite(derivedEv)&&Number.isFinite(Number(m.evEbitda))&&Number(m.evEbitda)!==0?derivedEv/Number(m.evEbitda):null;assignMissing(['ebitda','favok'],derivedEbitda);
    f.isYatirimRecommendation=r.recommendation;f.isYatirimTargetPrice=r.targetPrice;f.isYatirimUpsidePotentialPct=r.upsidePotentialPct;f.isYatirimRecommendationDate=r.recommendationDate;
    const hist=card.history||[],prev=hist[1]||null,days=r.recommendationDate?Math.max(0,(Date.now()-new Date(r.recommendationDate.split('.').reverse().join('-')+'T00:00:00+03:00').getTime())/86400000):null;
    rec.companyCard=card;rec.companyCardHistory=hist;rec.sources=[...new Set([...(rec.sources||rec.providers||[]),SOURCE])];
    rec.crossValidation={...(rec.crossValidation||{}),isYatirim:{checkedAt:card.fetchedAt,sourceHashSha256:card.sourceHashSha256||null,...comparisons,agreementScore:agreements.length?agreements.reduce((a,b)=>a+b,0)/agreements.length:null,stale:!!card.stale}};
    rec.enrichmentMetrics={...(rec.enrichmentMetrics||{}),isYatirim:{recommendation:r.recommendation,targetPrice:r.targetPrice,upsidePotentialPct:r.upsidePotentialPct,recommendationAgeDays:Number.isFinite(days)?days:null,targetRevision:prev&&Number.isFinite(r.targetPrice)&&Number.isFinite(prev.targetPrice)?r.targetPrice-prev.targetPrice:null,recommendationChanged:!!(prev&&r.recommendation&&prev.recommendation&&r.recommendation!==prev.recommendation),fundamentalAgreementScore:rec.crossValidation.isYatirim.agreementScore,hasTheme:!!r.theme,hasCatalyst:!!r.catalysts,hasRiskText:!!r.risks,sourceAgeHours:Math.max(0,(Date.now()-new Date(card.fetchedAt).getTime())/3600000)}};
    if(card.companyName&&state?.companyDirectory instanceof Map&&!state.companyDirectory.has(rec.sym))state.companyDirectory.set(rec.sym,{name:card.companyName,sector:rec.sector||''});return rec;
  }
  function getCached(sym,{allowStale=false}={}){const card=readJson(cacheKey(String(sym||'').trim().toUpperCase()));if(card?.status!=='OK')return null;if(!allowStale&&!fresh(card))return null;return card;}
  function attachCached(rec,{allowStale=false}={}){if(!rec?.sym)return rec;const card=getCached(rec.sym,{allowStale});return card?attach(rec,card):rec;}
  async function enrichRecord(rec,{force=false}={}){if(!rec?.sym)return rec;return attach(rec,await fetchCard(rec.sym,{force}));}
  async function enrichBatch(records,{force=false,limit=null}={}){if(active)return {accepted:false,error:'COMPANY_CARD_BATCH_ALREADY_RUNNING'};active=true;const list=(records||state?.records||[]).slice(0,limit==null?undefined:Number(limit));let ok=0,failed=0,changed=0;try{for(const rec of list){try{const before=rec.companyCard?.sourceHashSha256;await enrichRecord(rec,{force});if(rec.companyCard?.sourceHashSha256!==before)changed++;if(typeof persistRecord==='function')await persistRecord(rec);ok++;}catch(e){failed++;if(typeof log==='function')await log('warn',`${rec.sym}: İş Yatırım şirket kartı alınamadı`,{error:e.message});}}const calcRecords=globalThis.calculationRecords?.()||state.records.filter(r=>r?.calculationEligible!==false);if(typeof rebuildBehaviorProfiles==='function')await rebuildBehaviorProfiles(calcRecords);if(typeof rebuildModelViews==='function'){const built=rebuildModelViews(calcRecords);state.scores=built.scores;state.selection=built.selection;state.modelBySym=built.bySym;}if(typeof render==='function')render();return {accepted:true,total:list.length,ok,failed,changed};}finally{active=false;}}
  function dueSymbols(records=state?.records||[]){return records.filter(r=>!fresh(readJson(cacheKey(r.sym)))).map(r=>r.sym);}
  function summary(records=state?.records||[]){const cards=records.map(r=>r.companyCard).filter(x=>x?.status==='OK');return {source:SOURCE,coverage:records.length?cards.length/records.length:0,covered:cards.length,total:records.length,recommendations:cards.filter(x=>x.recommendation?.recommendation).length,targetPrices:cards.filter(x=>Number.isFinite(x.recommendation?.targetPrice)).length,due:dueSymbols(records).length,active};}
  globalThis.AurumIsYatirimCompanyCard={fetch:fetchCard,enrichRecord,enrichBatch,dueSymbols,summary,attach,getCached,attachCached,ttlMs:TTL_MS};
})();

/* ===== module: İş Yatırım integration ===== */
'use strict';

(function integrateIsYatirimCompanyCards(){
  const BATCH_SIZE=24;
  const CURSOR_KEY='aurum.isyatirim.companyCard.cursor.v1';
  let integrationRunning=false;

  function uniqueSymbols(){
    const out=[],seen=new Set();
    const push=s=>{s=String(s||'').trim().toUpperCase();if(s&&!seen.has(s)){seen.add(s);out.push(s);}};
    (state?.selection||[]).forEach(x=>push(x.sym));
    (state?.records||[]).filter(r=>{const f=r.fundamentals||{};const pe=f.pe??f.fk,pb=f.pb??f.pdDd;return pe==null||pb==null||!Number.isFinite(Number(pe))||!Number.isFinite(Number(pb))||!r.companyCard;}).forEach(r=>push(r.sym));
    (state?.records||[]).forEach(r=>push(r.sym));
    return out;
  }
  function selectedBatch(){
    const symbols=uniqueSymbols();if(!symbols.length)return [];
    let cursor=Number(localStorage.getItem(CURSOR_KEY)||0);if(!Number.isFinite(cursor)||cursor<0)cursor=0;
    const priority=new Set((state?.selection||[]).map(x=>x.sym));
    const due=new Set(globalThis.AurumIsYatirimCompanyCard?.dueSymbols(state.records)||[]);
    const ordered=[...symbols.filter(s=>priority.has(s)&&due.has(s)),...symbols.filter(s=>!priority.has(s)&&due.has(s))];
    if(!ordered.length)return [];
    const rotated=[...ordered.slice(cursor%ordered.length),...ordered.slice(0,cursor%ordered.length)];
    const batch=rotated.slice(0,BATCH_SIZE);localStorage.setItem(CURSOR_KEY,String((cursor+batch.length)%ordered.length));
    const map=state.recordMap||new Map((state.records||[]).map(r=>[r.sym,r]));return batch.map(s=>map.get(s)).filter(Boolean);
  }
  function marketContextFromCards(){
    const cards=(state.records||[]).map(r=>r.companyCard).filter(c=>c?.status==='OK');
    const recs=cards.map(c=>c.recommendation||{}).filter(r=>r.recommendation);
    const al=recs.filter(r=>r.recommendation==='AL').length,tut=recs.filter(r=>r.recommendation==='TUT').length,sat=recs.filter(r=>r.recommendation==='SAT').length;
    const upside=recs.map(r=>Number(r.upsidePotentialPct)).filter(Number.isFinite);
    const avg=upside.length?upside.reduce((a,b)=>a+b,0)/upside.length:null;
    const positive=upside.filter(x=>x>0).length;
    const breadth=recs.length?(al-sat)/recs.length:null;
    let regimeHint='YETERSİZ_VERİ';if(recs.length>=5){if((breadth??0)>.35&&(avg??0)>12)regimeHint='POZİTİF';else if((breadth??0)<-.15||(avg??0)<0)regimeHint='NEGATİF';else regimeHint='DENGELİ';}
    return {source:'ISYATIRIM_COMPANY_CARD',covered:cards.length,recommendationCount:recs.length,buyCount:al,holdCount:tut,sellCount:sat,positiveUpsideCount:positive,averageUpsidePotentialPct:avg,recommendationBreadth:breadth,regimeHint,updatedAt:new Date().toISOString()};
  }
  async function runEnrichment({force=false}={}){
    if(integrationRunning||!globalThis.AurumIsYatirimCompanyCard)return {accepted:false,error:'ENRICHMENT_BUSY_OR_NOT_READY'};
    integrationRunning=true;
    try{
      const batch=selectedBatch();if(!batch.length){state.isYatirimMarketContext=marketContextFromCards();return {accepted:true,total:0,changed:0};}
      const result=await AurumIsYatirimCompanyCard.enrichBatch(batch,{force});
      state.isYatirimCompanyCardSummary=AurumIsYatirimCompanyCard.summary(state.records);
      state.isYatirimMarketContext=marketContextFromCards();
      try{await dbPut('meta',{key:'isYatirimCompanyCardSummary',value:state.isYatirimCompanyCardSummary,updatedAt:new Date().toISOString()});}catch(_){}
      try{await dbPut('meta',{key:'isYatirimMarketContext',value:state.isYatirimMarketContext,updatedAt:new Date().toISOString()});}catch(_){}
      return result;
    }finally{integrationRunning=false;}
  }

  // Company-card enrichment remains an explicit feature adapter; the clean runtime owns all data/job sequencing.

  globalThis.AurumIsYatirimIntegration={run:runEnrichment,marketContext:marketContextFromCards,batchSize:BATCH_SIZE};
})();

/* Presentation is owned by the canonical runtime/core renderers. Legacy decorator/override layers removed. */

/* ===== module: R29 formula model ===== */

(()=>{
  if(globalThis.__aurumR29RewardK12Meta)return;
  globalThis.__aurumR29RewardK12Meta=true;

  const VERSION='29.2.0-k1-k7-seat-only';
  const EXPERTS=['K1','K2','K3','K4','K5','K6','K7'];
  const STORE_KEY='aurum.r29.k10RewardMemory.v2';
  const R27_LOCK_KEY='aurum.r27.kHistoricalLocked.v1';
  const MAX_EVENTS=30;
  const MEMORY_DECAY=.92;
  const MEMORY_PRIOR_WEIGHT=2;
  const K12_MARKET_SHARE=.70;
  const K12_K10_SHARE=.30;
  const S_KN_SHARE=1.00;
  const S_K12_SHARE=.00;
  const FUSION_RANK_SHARE=.70;
  const FUSION_SCORE_SHARE=.30;

  const OLD_BUILD=typeof buildModels==='function'?buildModels:globalThis.buildModels;
  const OLD_REBUILD=typeof rebuildModelViews==='function'?rebuildModelViews:globalThis.rebuildModelViews;
  const OLD_INLINE=globalThis.criterionInline||(typeof criterionInline==='function'?criterionInline:null);
  const OLD_ENSEMBLE=typeof ensembleForRun==='function'?ensembleForRun:globalThis.ensembleForRun;

  const num=v=>v!==null&&v!==undefined&&!(typeof v==='string'&&!v.trim())&&Number.isFinite(Number(v))?Number(v):null;
  const cap=(v,a=0,b=100)=>Math.max(a,Math.min(b,v!==null&&v!==undefined&&!(typeof v==='string'&&!v.trim())&&Number.isFinite(Number(v))?Number(v):a));
  const capSigned=(v,a=-1,b=1)=>Math.max(a,Math.min(b,v!==null&&v!==undefined&&!(typeof v==='string'&&!v.trim())&&Number.isFinite(Number(v))?Number(v):0));
  const vals=a=>(a||[]).map(num).filter(Number.isFinite);
  const avg=a=>{const x=vals(a);return x.length?x.reduce((s,v)=>s+v,0)/x.length:null};
  const med=a=>{const x=vals(a).sort((a,b)=>a-b);if(!x.length)return null;const i=Math.floor(x.length/2);return x.length%2?x[i]:(x[i-1]+x[i])/2};
  const sd=a=>{const x=vals(a);if(x.length<2)return 0;const m=avg(x);return Math.sqrt(avg(x.map(v=>(v-m)**2))||0)};
  const ratio=(a,fn)=>{const x=(a||[]).filter(Boolean);return x.length?x.filter(fn).length/x.length:.5};
  const squash=(v,scale=1)=>Number.isFinite(num(v))?Math.tanh(num(v)/Math.max(.0001,scale)):0;
  const n01=v=>Number.isFinite(num(v))?capSigned(2*num(v)-1,-1,1):0;
  const safeLog=v=>Number.isFinite(num(v))&&num(v)>0?Math.log(num(v)):0;
  const clone=v=>{try{return JSON.parse(JSON.stringify(v))}catch{return v}};
  const read=(k,f)=>{try{const v=JSON.parse(localStorage.getItem(k)||'null');return v??f}catch{return f}};
  const write=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v));return true}catch{return false}};
  const iso=()=>new Date().toISOString();
  const topN=()=>Math.max(1,Number(state?.settings?.topN||20));

  function store(){
    const s=read(STORE_KEY,{version:VERSION,drafts:{},pending:{},events:[]});
    if(!s.drafts||typeof s.drafts!=='object')s.drafts={};
    if(!s.pending||typeof s.pending!=='object')s.pending={};
    if(!Array.isArray(s.events))s.events=[];
    s.version=VERSION;return s;
  }
  function saveStore(s){
    const draftKeys=Object.keys(s.drafts||{}).sort().reverse().slice(0,3),drafts={};for(const k of draftKeys)drafts[k]=s.drafts[k];s.drafts=drafts;
    const pendingKeys=Object.keys(s.pending||{}).sort().reverse().slice(0,3),pending={};for(const k of pendingKeys)pending[k]=s.pending[k];s.pending=pending;
    s.events=(s.events||[]).sort((a,b)=>String(b.outcomeDate||'').localeCompare(String(a.outcomeDate||''))).slice(0,MAX_EVENTS);
    s.updatedAt=iso();write(STORE_KEY,s);return s;
  }
  function lockedDates(){
    const v=read(R27_LOCK_KEY,{rows:{}});return Object.keys(v?.rows||{}).filter(Boolean).sort();
  }
  function majorityDate(rows){
    const m=new Map();for(const r of rows||[]){const d=String(r?.latestDate||r?.series?.date?.at?.(-1)||'').slice(0,10);if(d)m.set(d,(m.get(d)||0)+1)}
    return [...m.entries()].sort((a,b)=>b[1]-a[1]||String(b[0]).localeCompare(String(a[0])))[0]?.[0]||null;
  }
  function isPIT(rows){return (rows||[]).some(r=>r?.__aurumPITAnchor||r?.pointInTimeAnchor)}
  function closeArray(rec){const s=rec?.series||{};return s.calcClose||s.adjustedClose||s.adjClose||s.close||[]}
  function dayReturn(rec,date){
    const dates=rec?.series?.date||[],i=dates.lastIndexOf(date);if(i<=0)return null;const a=Number(closeArray(rec)?.[i]),b=Number(closeArray(rec)?.[i-1]);if(!Number.isFinite(a)||!Number.isFinite(b)||!b)return null;const v=100*(a/b-1);return Math.abs(v)<80?v:null;
  }
  function realFullRanking(records,date,universe){
    const allow=new Set(universe||[]);return (records||[]).filter(r=>!allow.size||allow.has(r.sym)).map(r=>({sym:r.sym,ret:dayReturn(r,date)})).filter(x=>Number.isFinite(x.ret)).sort((a,b)=>b.ret-a.ret||String(a.sym).localeCompare(String(b.sym)));
  }
  function percentileQuality(rank,n){return Number.isFinite(rank)&&n>1?cap(1-(rank-1)/(n-1),0,1):null}
  /* Bir hisse ancak iki koşulu birlikte sağlarsa yüksek ödül alır:
     (a) ertesi kesin Reel sıralamada yukarıda gerçekleşmesi ve
     (b) Kn tahmin sırasının bu gerçekleşen yüzdelik sıraya yakın olması.
     Böylece 490->492 gibi "yakın ama başarısız" durumlar ödüllendirilmez. */
  function pairReward(predRank,predN,realRank,realN){
    const p=percentileQuality(predRank,predN),r=percentileQuality(realRank,realN);if(!Number.isFinite(p)||!Number.isFinite(r))return null;
    const closeness=cap(1-Math.abs(p-r),0,1),score=100*r*closeness;
    return {score,closeness,realQuality:r,predQuality:p,percentileError:Math.abs(p-r)};
  }

  function snapshotFromScores(date,scores,eligible){
    if(!date)return null;const universe=(eligible||[]).map(x=>x.sym).filter(Boolean),experts={};if(universe.length<20)return null;
    for(const k of EXPERTS){const a=(scores?.[k]||[]).map(x=>x.sym).filter(Boolean);if(a.length<Math.min(20,universe.length))return null;experts[k]=a;}
    return {date,capturedAt:iso(),universe,experts,source:'PURE_KN_FULL_RANK_T0'};
  }
  function captureDraft(date,scores,eligible){
    const snap=snapshotFromScores(date,scores,eligible);if(!snap)return false;const s=store();
    if(!s.pending[date]&&!s.events.some(x=>x.predictionDate===date))s.drafts[date]=snap;
    saveStore(s);return true;
  }
  function freezeLockedDrafts(){
    const s=store(),locks=new Set(lockedDates());let changed=false;
    for(const [d,draft] of Object.entries(s.drafts||{})){
      if(locks.has(d)&&!s.pending[d]&&!s.events.some(x=>x.predictionDate===d)){
        s.pending[d]=clone({...draft,lockedAt:iso()});delete s.drafts[d];changed=true;
      }
    }
    if(changed)saveStore(s);return s;
  }
  function nextLockedAfter(date,locks){return (locks||[]).find(d=>d>date)||null}

  function resolveRewardEvents(records){
    const s=freezeLockedDrafts(),locks=lockedDates();let changed=false;
    for(const [predictionDate,snap] of Object.entries(s.pending||{})){
      if(s.events.some(x=>x.predictionDate===predictionDate)){delete s.pending[predictionDate];changed=true;continue;}
      const outcomeDate=nextLockedAfter(predictionDate,locks);if(!outcomeDate)continue;
      const real=realFullRanking(records,outcomeDate,snap.universe),minNeed=Math.max(20,Math.ceil((snap.universe?.length||0)*.60));if(real.length<minNeed)continue;
      const realRank=new Map(real.map((x,i)=>[x.sym,i+1])),rankMaps={};for(const k of EXPERTS)rankMaps[k]=new Map((snap.experts?.[k]||[]).map((sym,i)=>[sym,i+1]));
      const rows=[];
      for(const sym of snap.universe||[]){
        const rr=realRank.get(sym);if(!rr)continue;const per=[],cl=[],err=[];
        for(const k of EXPERTS){const pr=rankMaps[k].get(sym);if(!pr)continue;const z=pairReward(pr,snap.experts[k].length,rr,real.length);if(z){per.push(z.score);cl.push(z.closeness);err.push(z.percentileError);}}
        if(!per.length)continue;
        rows.push([sym,Number((avg(per)??0).toFixed(4)),rr,Number((100*(percentileQuality(rr,real.length)??0)).toFixed(3)),Number((100*(avg(cl)??0)).toFixed(3)),Number((100*(avg(err)??0)).toFixed(3)),per.length]);
      }
      rows.sort((a,b)=>b[1]-a[1]||a[2]-b[2]||String(a[0]).localeCompare(String(b[0])));
      s.events.unshift({predictionDate,outcomeDate,resolvedAt:iso(),universeSize:snap.universe.length,realUniverseSize:real.length,formula:'pair=100*realPercentileQuality*(1-|predPercentile-realPercentile|); eventK10=mean(K1-K7)',rows});
      delete s.pending[predictionDate];changed=true;
    }
    if(changed)saveStore(s);return s;
  }

  function k10MemoryRows(eligible,asOfDate,records){
    const s=resolveRewardEvents(records||state?.records||[]),events=(s.events||[]).filter(e=>!asOfDate||String(e.outcomeDate||'')<=String(asOfDate)).sort((a,b)=>String(b.outcomeDate||'').localeCompare(String(a.outcomeDate||''))).slice(0,MAX_EVENTS),acc=new Map();
    events.forEach((e,age)=>{const w=Math.pow(MEMORY_DECAY,age);for(const row of e.rows||[]){const sym=row[0],score=num(row[1]);if(!Number.isFinite(score))continue;const z=acc.get(sym)||{sum:0,w:0,n:0,last:null};z.sum+=w*score;z.w+=w;z.n++;if(!z.last)z.last={predictionDate:e.predictionDate,outcomeDate:e.outcomeDate,eventScore:score,realRank:num(row[2])};acc.set(sym,z);}});
    return (eligible||[]).map(r=>{const z=acc.get(r.sym),score=z?(z.sum+MEMORY_PRIOR_WEIGHT*50)/(z.w+MEMORY_PRIOR_WEIGHT):50,confidence=z?cap(z.w/(z.w+MEMORY_PRIOR_WEIGHT),0,1):0;return {sym:r.sym,record:r,score:cap(score),rewardPenalty:score-50,evidenceCount:z?.n||0,memoryConfidence:confidence,lastPredictionDate:z?.last?.predictionDate||null,lastOutcomeDate:z?.last?.outcomeDate||null,lastEventScore:z?.last?.eventScore??null,lastRealRank:z?.last?.realRank??null,k10Role:'NEXT_SESSION_REWARD_PENALTY_MEMORY'};}).sort((a,b)=>b.score-a.score||b.evidenceCount-a.evidenceCount||String(a.sym).localeCompare(String(b.sym)));
  }

  /* K12-A: piyasanın güncel karakteri / esen rüzgâr. */
  function dominantRegime(A){const c={BULL:0,BEAR:0,VOLATILE:0,NEUTRAL:0};for(const r of A)c[r?.marketRegime]!==undefined&&(c[r.marketRegime]++);const best=Object.entries(c).sort((a,b)=>b[1]-a[1])[0]||['NEUTRAL',0];return {regime:best[0],share:A.length?best[1]/A.length:0,counts:c}}
  function marketCharacter(A){
    const active=(A||[]).filter(r=>r&&Number.isFinite(num(r.livePrice))),pos=ratio(active,r=>num(r.dayChange)>0),above20=ratio(active,r=>num(r.ema20)>0&&num(r.livePrice)>num(r.ema20)),above50=ratio(active,r=>num(r.ema50)>0&&num(r.livePrice)>num(r.ema50)),macd=ratio(active,r=>num(r.macdHistDelta)>0),breakout=ratio(active,r=>num(r.volumeBreakout)>=1.2);
    const mDay=med(active.map(r=>r.dayChange)),mRet5=med(active.map(r=>r.retTL5)),mRel5=med(active.map(r=>Number.isFinite(num(r.retTL5))&&Number.isFinite(num(r.retXU5))?num(r.retTL5)-num(r.retXU5):null)),mRoc5=med(active.map(r=>r.roc5)),mAtr=med(active.map(r=>r.atrPct)),disp=sd(active.map(r=>r.dayChange)),mVol=med(active.map(r=>r.volumeBreakout)),mTurn=med(active.map(r=>r.turnoverRatio)),dom=dominantRegime(active);
    const breadth=capSigned(.42*(2*pos-1)+.33*(2*above20-1)+.25*(2*above50-1)),trend=capSigned(.30*squash(mRet5,6)+.20*squash(mRel5,5)+.28*(2*above20-1)+.12*(2*above50-1)+.10*(dom.regime==='BULL'?dom.share:dom.regime==='BEAR'?-dom.share:0)),momentum=capSigned(.28*squash(mDay,2.2)+.27*squash(mRet5,6)+.15*squash(mRoc5,6)+.18*(2*macd-1)+.12*(2*breakout-1)),volatility=capSigned(.62*squash((mAtr??3.5)-3.5,2.8)+.38*squash(disp-1.8,2.3)),volume=capSigned(.58*squash(safeLog(mVol||1),.55)+.27*squash((mTurn??1)-1,.75)+.15*(2*breakout-1)),risk=capSigned(.42*breadth+.28*momentum+.18*trend+.12*(volatility*Math.sign(momentum||trend||1)));
    let regime=dom.regime;if(dom.share<.38){if(volatility>.48)regime='VOLATILE';else if(trend>.24&&breadth>.08)regime='BULL';else if(trend<-.24&&breadth<-.08)regime='BEAR';else regime='NEUTRAL';}
    const coverage=active.length?active.filter(r=>[r.dayChange,r.ema20,r.atrPct,r.volumeBreakout].filter(x=>Number.isFinite(num(x))).length>=3).length/active.length:0,magnitude=avg([Math.abs(trend),Math.abs(momentum),Math.abs(volatility),Math.abs(volume),Math.abs(risk),Math.abs(breadth)])||0,agreement=1-cap(Math.abs(trend-breadth)/2,0,1),confidence=cap(.45*coverage+.30*magnitude+.25*agreement,0,1);
    return {version:VERSION,regime,confidence,vector:{trend,momentum,volatility,volume,risk},breadth,stats:{positiveBreadth:pos,aboveEma20:above20,aboveEma50:above50,macdPositive:macd,breakoutBreadth:breakout,medianDayChange:mDay,medianRet5:mRet5,medianRelative5:mRel5,medianAtr:mAtr,dispersion:disp,medianVolumeBreakout:mVol},universe:active.length,asOf:active.map(x=>String(x.latestDate||'')).filter(Boolean).sort().at(-1)||null};
  }
  function stockCharacter(r){
    const gp=r?.genomeProfile||r?.behaviorProfile?.genome||{},f=gp?.features||{},bp=r?.behaviorProfile||{};
    const trend=capSigned(.30*n01(f.trendPersistence)+.25*squash(f.alpha21,8)+.20*squash(f.ret21d,14)+.15*n01(f.breakout20Success)+.10*n01(f.breakout63Success)),momentum=capSigned(.28*squash(f.alpha5,6)+.20*squash(f.alpha10,8)+.18*squash(f.returnAcceleration,5)+.17*n01(f.positiveDayRate)+.17*squash(gp?.analog?.expectedMax,8)),volatility=capSigned(.48*squash((num(f.vol21)??num(r?.atrPct)??3.5)-3.5,2.8)+.27*squash((num(f.rangeExpansion)??1)-1,.7)+.25*squash((num(f.atrMean21)??3.5)-3.5,2.8)),volume=capSigned(.35*squash((num(f.volumeRatio5_21)??1)-1,.65)+.25*squash((num(f.turnoverRatio5_21)??1)-1,.65)+.20*n01(f.accumulationRate)+.20*capSigned((num(f.accumulationRate)??.5)-(num(f.distributionRate)??.5))),risk=capSigned(.34*squash((num(f.beta63)??1)-1,.55)+.24*squash((num(f.upCapture)??1)-1,.55)+.18*squash((num(f.downCapture)??1)-1,.55)+.14*squash(f.alpha21,8)+.10*squash(f.shockSensitivity,5));
    const gconf=cap((num(gp?.confidence)??0)/100,0,1),bconf=cap((num(bp?.confidence)??0)/100,0,1),feature=cap((num(gp?.featureCount)??0)/Math.max(1,num(gp?.totalFeatures)||80),0,1),confidence=cap(.50*gconf+.30*bconf+.20*feature,0,1);
    return {vector:{trend,momentum,volatility,volume,risk},confidence,profileFingerprint:bp?.fingerprint||null,evidenceId:state?.behaviorMemory?.latestEvidenceId||null,temperament:gp?.temperament||bp?.character?.type||null};
  }
  function cosineFit(a,b){const ks=['trend','momentum','volatility','volume','risk'];let dot=0,na=0,nb=0,dist=0,n=0;for(const k of ks){const x=capSigned(a?.[k]),y=capSigned(b?.[k]);dot+=x*y;na+=x*x;nb+=y*y;dist+=Math.abs(x-y);n++;}const cos=na>1e-8&&nb>1e-8?dot/Math.sqrt(na*nb):0,cosScore=50+50*capSigned(cos),distanceScore=100*(1-dist/(Math.max(1,n)*2));return cap(.58*cosScore+.42*distanceScore)}
  function regimeRaw(r,regime){const f=r?.genomeProfile?.features||{},g=r?.genomeProfile||{};let ar=null,pr=null,fr=null;if(regime==='BULL'){ar=f.bullAvgReturn;pr=f.bullPositiveRate;fr=f.bullFiveRate;}else if(regime==='BEAR'){ar=f.bearAvgReturn;pr=f.bearPositiveRate;fr=f.bearFiveRate;}else if(regime==='VOLATILE'){ar=f.volatileAvgReturn;pr=f.volatilePositiveRate;fr=f.volatileFiveRate;}else{ar=f.neutralAvgReturn;pr=f.positiveDayRate;fr=g?.analog?.fiveRate;}const avgPart=squash(ar,5),positive=Number.isFinite(num(pr))?2*num(pr)-1:0,five=Number.isFinite(num(fr))?2*num(fr)-1:0,down=regime==='BEAR'?squash(f.downsideResilience,5):0,scenario=Number.isFinite(num(g?.currentScenarioStats?.dualRate))?2*num(g.currentScenarioStats.dualRate)-1:0;return .34*avgPart+.24*positive+.20*five+.12*down+.10*scenario}
  function percentileMap(rows,key){const sorted=rows.map(x=>({sym:x.sym,v:num(x[key])})).filter(x=>Number.isFinite(x.v)).sort((a,b)=>a.v-b.v||String(a.sym).localeCompare(String(b.sym))),out=new Map();if(!sorted.length)return out;for(let i=0;i<sorted.length;i++)out.set(sorted[i].sym,sorted.length===1?50:100*i/(sorted.length-1));return out}
  function k12MarketRows(A,market){
    const tmp=(A||[]).map(r=>{const ch=stockCharacter(r),compatibility=cosineFit(market.vector,ch.vector),regimeEvidence=regimeRaw(r,market.regime);return {sym:r.sym,record:r,ch,compatibility,regimeEvidence}}),regPct=percentileMap(tmp,'regimeEvidence');
    return tmp.map(x=>{const regimeFit=regPct.get(x.sym)??50,base=.60*x.compatibility+.25*regimeFit+.15*(100*x.ch.confidence),trust=.25+.75*market.confidence,score=cap(50+(base-50)*trust);return {sym:x.sym,record:x.record,score,marketCharacterScore:score,marketCompatibility:x.compatibility,regimeFit,characterConfidence:x.ch.confidence,marketCharacterConfidence:market.confidence,marketRegime:market.regime,characterFingerprint:x.ch.profileFingerprint,characterEvidenceId:x.ch.evidenceId,characterTemperament:x.ch.temperament,k12Role:'MARKET_CHARACTER_ONLY'};}).sort((a,b)=>b.score-a.score||b.marketCompatibility-a.marketCompatibility||String(a.sym).localeCompare(String(b.sym)));
  }
  function combineK12(marketRows,k10Rows){
    const km=new Map((k10Rows||[]).map(x=>[x.sym,x]));return (marketRows||[]).map(x=>{const k10=km.get(x.sym),k10Score=num(k10?.score)??50,score=K12_MARKET_SHARE*x.score+K12_K10_SHARE*k10Score;return {...x,score:cap(score),marketCharacterScore:x.score,k10RewardScore:k10Score,k10RewardPenalty:k10Score-50,k10EvidenceCount:k10?.evidenceCount||0,k10MemoryConfidence:k10?.memoryConfidence||0,k10LastOutcomeDate:k10?.lastOutcomeDate||null,k12Role:'MARKET_CHARACTER_PLUS_K10_MEMORY',k12Formula:`${K12_MARKET_SHARE}*MARKET_CHARACTER+${K12_K10_SHARE}*K10_MEMORY`};}).sort((a,b)=>b.score-a.score||b.marketCharacterScore-a.marketCharacterScore||String(a.sym).localeCompare(String(b.sym)));
  }

  function pureExpertRows(rows){
    const mapped=(rows||[]).map((x,i)=>{const raw=num(x?.rawScore),pre=num(x?.preK12Rank);return {...x,score:Number.isFinite(raw)?raw:num(x?.score),__pureRank:Number.isFinite(pre)?pre:i+1};}).filter(x=>Number.isFinite(num(x.score)));
    return mapped.sort((a,b)=>a.__pureRank-b.__pureRank||String(a.sym).localeCompare(String(b.sym))).map(({__pureRank,...x})=>x);
  }
  function pureScores(scores){const out={...(scores||{})};for(const k of EXPERTS)out[k]=pureExpertRows(scores?.[k]||[]);return out;}

  function sWeights(weights){
    const base=typeof BASE_WEIGHTS!=='undefined'?BASE_WEIGHTS:{},o={};let den=0;for(const k of EXPERTS){const w=Math.max(0,num(weights?.[k])??num(base?.[k])??1);o[k]=w;den+=w;}if(!den){for(const k of EXPERTS)o[k]=1/EXPERTS.length;return o;}for(const k of EXPERTS)o[k]/=den;return o;
  }
  function fusionRows(eligible,scores,weights){
    const n=Math.max(1,eligible.length),ew=sWeights(weights),maps={};
    for(const k of EXPERTS){const rows=scores?.[k]||[],rank=new Map(),score=new Map();rows.forEach((x,i)=>{rank.set(x.sym,n<=1?50:100*(1-i/(n-1)));score.set(x.sym,num(x.score));});maps[k]={rank,score};}
    const rows=(eligible||[]).map(r=>{let rs=0,ss=0,w=0;for(const k of EXPERTS){const rr=maps[k].rank.get(r.sym),sc=maps[k].score.get(r.sym),wt=ew[k]||0;if(Number.isFinite(rr)&&Number.isFinite(sc)&&wt>0){rs+=wt*rr;ss+=wt*sc;w+=wt;}}const rankConsensus=w?rs/w:null,scoreConsensus=w?ss/w:null,score=w?FUSION_RANK_SHARE*rankConsensus+FUSION_SCORE_SHARE*scoreConsensus:null;return {sym:r.sym,record:r,score,rankConsensus,scoreConsensus,sExpertWeightTotal:w};}).filter(x=>Number.isFinite(x.score)).sort((a,b)=>b.score-a.score||b.rankConsensus-a.rankConsensus||String(a.sym).localeCompare(String(b.sym)));
    return {rows,weights:ew};
  }
  function executionRiskFor(r,base){
    if(Number.isFinite(num(base?.executionRisk)))return cap(num(base.executionRisk),0,1);const maxPart=Math.max(.01,num(state?.settings?.maxParticipationPct)||1),q=Number.isFinite(num(r?.quality))?num(r.quality)/100:.5;
    return cap(.31*cap((num(r?.estimatedCostPct)||0)/2,0,1)+.18*cap((num(r?.participationPct)||0)/maxPart,0,1)+.18*(r?.limitUpRisk?1:0)+.13*cap((num(r?.upperWickPct)||0)/6,0,1)+.08*(1-q),0,1);
  }
  function buildS(eligible,scores,weights,oldBySym,options={},market=null){
    const fusion=fusionRows(eligible,scores,weights),fm=new Map(fusion.rows.map((x,i)=>[x.sym,{...x,rank:i+1}])),rankMaps={};for(const k of EXPERTS)rankMaps[k]=new Map((scores?.[k]||[]).map((x,i)=>[x.sym,{rank:i+1,row:x}]));const k10m=new Map((scores?.K10||[]).map((x,i)=>[x.sym,{rank:i+1,row:x}])),k12m=new Map((scores?.K12||[]).map((x,i)=>[x.sym,{rank:i+1,row:x}])),bySym=new Map();
    for(const r of eligible){
      const old=oldBySym?.get?.(r.sym)||{},kn=fm.get(r.sym)?.score??0,k12=k12m.get(r.sym),meta=num(k12?.row?.score)??50,baseScore=kn,er=executionRiskFor(r,old),final=cap(baseScore-12*er),contrib=[];
      for(const k of EXPERTS){const z=rankMaps[k].get(r.sym);if(z)contrib.push({k,rank:z.rank,score:num(z.row.score),weight:fusion.weights[k]||0});}
      let probability=null,observations=0;if(options.calibrate!==false&&typeof calibratedProbability==='function'){try{const latest=eligible.map(x=>x.latestDate).filter(Boolean).sort().at(-1),ctx=typeof marketContext==='function'?marketContext(new Date(),latest):{window:'MIDDAY'},cal=calibratedProbability(final,r.marketRegime,ctx.window);if(Number.isFinite(num(cal?.prob))){probability=num(cal.prob);observations=num(cal.observations)||0;}}catch{}}
      if(!Number.isFinite(probability))probability=Math.max(.02,Math.min(.35,.025+.28/(1+Math.exp(-(final-76)/7))));const k10=k10m.get(r.sym),warnings=[...(old.warnings||r.warnings||[])];
      bySym.set(r.sym,{...old,...r,totalScore:final,sBaseBeforeExecution:baseScore,sKnFusionScore:kn,sK12MetaScore:meta,sKnShare:S_KN_SHARE,sK12Share:S_K12_SHARE,sRankConsensus:fm.get(r.sym)?.rankConsensus??null,sScoreConsensus:fm.get(r.sym)?.scoreConsensus??null,targetProbability:probability,confidenceObservations:observations,contributions:contrib,supportingCriteria:contrib.filter(x=>x.rank<=topN()).map(x=>x.k),executionRisk:er,riskLevel:er>.62?'Yüksek':er>.34?'Orta':'Düşük',warnings,k10RewardScore:num(k10?.row?.score),k10RewardPenalty:num(k10?.row?.rewardPenalty),k10RewardRank:k10?.rank||null,k10EvidenceCount:k10?.row?.evidenceCount||0,k10LastOutcomeDate:k10?.row?.lastOutcomeDate||null,k12ContextScore:meta,k12ContextRank:k12?.rank||null,k12MarketCharacterScore:num(k12?.row?.marketCharacterScore),k12MarketCompatibility:num(k12?.row?.marketCompatibility),k12RegimeFit:num(k12?.row?.regimeFit),k12CharacterConfidence:num(k12?.row?.characterConfidence),marketCharacter:market||state?.k12Context?.market||null,sFusionMethod:'R36_K1_K7_ONLY_FUSION',sDirectExperts:[...EXPERTS],k10DirectSeat:false,k12DirectSeat:false});
    }
    const ranked=[...bySym.values()].sort((a,b)=>b.totalScore-a.totalScore||String(a.sym).localeCompare(String(b.sym))),selection=typeof constructAdaptivePortfolio==='function'?constructAdaptivePortfolio(ranked):ranked.slice(0,topN());return {bySym,selection,expertWeights:fusion.weights,fusionRows:fusion.rows};
  }

  /* Performans ağırlıklarının ileri-dönem doğrulaması yalnız saf Kn uzmanlarını yarıştırır. K10/K12 oy vermez. */
  function ensembleForRunR29(run,weights){
    const ew=sWeights(weights),union=new Map();
    for(const k of EXPERTS){const list=run?.criteria?.[k]||[],n=Math.max(1,list.length-1),wt=ew[k]||0;list.forEach((x,i)=>{const row=union.get(x.sym)||{sym:x.sym,score:0,w:0,dualHit:x.dualHit,reelTop20:x.reelTop20,fivePct:x.fivePct,maxNetReturn:x.maxNetReturn,closeNetReturn:x.closeNetReturn};const rankScore=1-i/n,raw=Number.isFinite(num(x.score))?num(x.score)/100:rankScore;row.score+=wt*(FUSION_RANK_SHARE*rankScore+FUSION_SCORE_SHARE*raw);row.w+=wt;union.set(x.sym,row);});}
    return [...union.values()].map(x=>({...x,score:x.w?x.score/x.w:0})).sort((a,b)=>b.score-a.score||String(a.sym).localeCompare(String(b.sym))).slice(0,20);
  }

  function applyR29(base,records,options={}){
    if(!base?.eligible?.length||!base?.scores)return base;
    const eligible=base.eligible,asOf=majorityDate(eligible),market=marketCharacter(eligible),k10=k10MemoryRows(eligible,asOf,records),k12=combineK12(k12MarketRows(eligible,market),k10);
    /* K1-K9,K11 saf tutulur. Eğer R29 yüklenirken R28 aynı oturumda hâlâ sarılıysa, R28'in rawScore/preK12Rank alanlarından saf sıra geri kurulur. */
    const expertScores=pureScores(base.scores),scores={...expertScores,K10:k10,K12:k12},built=buildS(eligible,scores,base.weights||{},base.bySym,options,market),pit=isPIT(eligible);
    const result={...base,scores,bySym:built.bySym,selection:built.selection,k12Context:{version:VERSION,marketShare:K12_MARKET_SHARE,k10Share:K12_K10_SHARE,sKnShare:S_KN_SHARE,sK12Share:S_K12_SHARE,market,expertWeights:built.expertWeights,directSeat:false,k10DirectSeat:false,sMethod:'R36_K1_K7_ONLY_FUSION'}};
    if(!pit&&asOf){captureDraft(asOf,scores,eligible);state.k12Context=result.k12Context;state.__r29KnSnapshot={version:VERSION,at:iso(),date:asOf,weights:{...(base.weights||{})},market,scoreCounts:Object.fromEntries([...EXPERTS,'K10','K12'].map(k=>[k,scores?.[k]?.length||0]))};setTimeout(()=>{try{resolveRewardEvents(state?.records||records||[])}catch{}},0);}
    return result;
  }

  function fixedBuildModels(records,options={}){if(typeof OLD_BUILD!=='function')throw new Error('R29: buildModels bulunamadı');return applyR29(OLD_BUILD.apply(this,arguments),records,options)}
  function hasUsableKnScores(){return EXPERTS.every(k=>Array.isArray(state?.scores?.[k])&&state.scores[k].length>=topN())}
  function sStage(){return state?.calculating&&(String(state?.progress?.current||'')==='Nihai seçim'||/^S\b/i.test(String(state?.progress?.stage||'')))}
  function fixedRebuildModelViews(records){
    if(sStage()&&hasUsableKnScores()){
      const eligible=(records||[]).filter(r=>{try{return typeof globalFilter==='function'?!!globalFilter(r)?.pass:true}catch{return true}}),date=majorityDate(eligible),weights=state?.__r29KnSnapshot?.weights||state?.performance?.weights||{},market=marketCharacter(eligible),k10=k10MemoryRows(eligible,date,records),k12=combineK12(k12MarketRows(eligible,market),k10),expertScores=pureScores(state.scores),scores={...expertScores,K10:k10,K12:k12},built=buildS(eligible,scores,weights,state.modelBySym,{calibrate:true},market);
      state.k12Context={version:VERSION,marketShare:K12_MARKET_SHARE,k10Share:K12_K10_SHARE,sKnShare:S_KN_SHARE,sK12Share:S_K12_SHARE,market,expertWeights:built.expertWeights,directSeat:false,k10DirectSeat:false,sMethod:'R36_K1_K7_ONLY_FUSION',reusedKn:true};
      return {scores,selection:built.selection,eligible,weights,bySym:built.bySym,k12Context:state.k12Context};
    }
    /* OLD_REBUILD içindeki buildModels çağrısı artık fixedBuildModels'a gider; sonucu ikinci kez applyR29 ile sarmalama. */
    return typeof OLD_REBUILD==='function'?OLD_REBUILD.apply(this,arguments):fixedBuildModels(records,{calibrate:true});
  }

  globalThis.AurumMetaEnhance=applyR29;
  globalThis.AurumR37Ensemble=ensembleForRunR29;
  /* R37: buildModels/rebuildModelViews artık core.js içindeki tek canonical ModelEngine'dir; runtime monkey-patch kaldırıldı. */

  try{
    if(typeof CRITERION_CATALOG!=='undefined'){
      CRITERION_CATALOG.K10={name:'Ceza / Ödül Hafızası',desc:'Yalnız K1–K7 saf tam sıralamalarını sonraki işlem gününün kesin Reel sıralamasıyla karşılaştırır ve son 30 kesinleşmiş olayın azalan ağırlıklı hafızasını üretir. Bağımsız aday/koltuk vermez; KnTopN işlem getirisi, AL/SAT, sanal portföy ve Kn_Trend ortalamasına katılmaz.'};
      CRITERION_CATALOG.K12={name:'Piyasa Karakteri + K10 Hafızası',desc:'Piyasa rüzgârı, hisse karakteri ve K10 hafızasını meta analiz olarak gösterir. S nihai puanına veya koltuk dağıtımına katkı vermez; KnTopN işlem getirisi, AL/SAT, sanal portföy ve Kn_Trend ortalamasına katılmaz.'};
    }
  }catch{}
  if(typeof OLD_INLINE==='function'){
    const inline=function(k){let out=OLD_INLINE.apply(this,arguments);if(typeof out==='string'&&String(k)==='K10')out=out.replace(/META[^<]*/i,'CEZA/ÖDÜL · yalnız K1–K7 → D+1 kesin Reel · işlem/S oyu yok');if(typeof out==='string'&&String(k)==='K12')out=out.replace(/META[^<]*/i,'META · piyasa/karakter + K10 · S/işlem payı yok');return out;};globalThis.criterionInline=inline;try{criterionInline=inline}catch{}
  }

  globalThis.AurumR29System={
    version:VERSION,
    constants:{experts:[...EXPERTS],maxEvents:MAX_EVENTS,memoryDecay:MEMORY_DECAY,k12MarketShare:K12_MARKET_SHARE,k12K10Share:K12_K10_SHARE,sKnShare:S_KN_SHARE,sK12Share:S_K12_SHARE,fusionRankShare:FUSION_RANK_SHARE,fusionScoreShare:FUSION_SCORE_SHARE},
    status:()=>{const s=store(),h=s.events?.[0]||null;return {version:VERSION,latestRewardEvent:h?{predictionDate:h.predictionDate,outcomeDate:h.outcomeDate,universeSize:h.universeSize,realUniverseSize:h.realUniverseSize}:null,pending:Object.keys(s.pending||{}).sort().reverse(),drafts:Object.keys(s.drafts||{}).sort().reverse(),eventCount:s.events.length,k12Context:state?.k12Context||null,knSnapshot:state?.__r29KnSnapshot||null};},
    rewardMemory:(asOf=null)=>clone(k10MemoryRows((state?.records||[]).filter(r=>{try{return typeof globalFilter==='function'?globalFilter(r)?.pass:true}catch{return true}}),asOf||majorityDate(state?.records||[]),state?.records||[])),
    refresh:()=>{resolveRewardEvents(state?.records||[]);const out=fixedRebuildModelViews(state?.records||[]);if(out){state.scores=out.scores;state.selection=out.selection;state.modelBySym=out.bySym;}try{globalThis.render?.()}catch{}return out;}
  };

  /* Reward resolution runs only inside an explicit/Veriler-triggered model pipeline. */
})();

/* ===== module: trend view ===== */

(()=>{globalThis.AurumR31TrendView={version:'36.0.0-k1-k7-trend',criteria:['K1','K2','K3','K4','K5','K6','K7']};})();
