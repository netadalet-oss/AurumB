/* Aurum BIST Top 20 — REV20 Offline-First Runtime
   Policy:
   - OpenAI: live
   - Market/company news page: live
   - Data providers: network only while an explicit/scheduled data-sync job is active
   - All other page navigation: local state / IndexedDB only
*/
(()=>{
  'use strict';
  if (globalThis.__AURUM_REV20_OFFLINE__) return;
  globalThis.__AURUM_REV20_OFFLINE__ = true;

  const nativeFetch = globalThis.fetch.bind(globalThis);
  const NEWS_HOSTS = new Set([
    'www.isyatirim.com.tr','isyatirim.com.tr',
    'bigpara.hurriyet.com.tr','www.bigpara.hurriyet.com.tr',
    'query1.finance.yahoo.com','query2.finance.yahoo.com',
    'finance.yahoo.com','www.kap.org.tr','kap.org.tr'
  ]);

  function runtimeBusy(){
    try{
      if (globalThis.state?.syncing) return true;
      const r = globalThis.AurumRuntime?.status?.();
      const s = String(r?.status||'').toUpperCase();
      return ['SCHEDULED','FETCHING_DATA','WAITING_FOR_NETWORK','RETRY_PENDING','RUNNING'].includes(s);
    }catch{return false;}
  }

  function marketLive(){
    try{return globalThis.state?.page === 'market';}catch{return false;}
  }

  function normalizeRelayUrl(value){
    try{
      const u=new URL(String(value||'').trim(),location.href);
      if(u.protocol!=='https:') return null;
      if(u.hostname.toLowerCase()!=='script.google.com') return null;
      // Ignore fragments only; endpoint path + query/token must stay identical.
      u.hash='';
      return u;
    }catch{return null;}
  }

  function configuredTradeRelay(){
    try{
      // The application state in core.js is lexical (const state), not window/globalThis.state.
      // Read it through the trusted runtime getter exported by the trade-alert module.
      const fromRuntime=(typeof globalThis.AurumTradeAlerts?.relayUrl==='function')
        ? globalThis.AurumTradeAlerts.relayUrl()
        : '';
      const fromBridge=String(globalThis.__AURUM_TRADE_RELAY_URL__||'');
      return normalizeRelayUrl(fromRuntime||fromBridge||'');
    }catch{return null;}
  }

  function tradeRelayAllowed(u){
    try{
      const saved=configuredTradeRelay();
      if(!saved) return false;
      const host=u.hostname.toLowerCase();
      if(host==='script.google.com'){
        const req=normalizeRelayUrl(u.href);
        return !!req && req.origin===saved.origin && req.pathname===saved.pathname && req.search===saved.search;
      }
      // Redirects are followed internally by native fetch. Keep this only for compatibility.
      return host==='script.googleusercontent.com';
    }catch{return false;}
  }

  // Dedicated narrowly-scoped relay transport. It validates the configured Apps Script
  // endpoint first, then calls the WebView's original native fetch directly. This avoids
  // the offline-first guard accidentally blocking the authorized AL/SAT relay itself,
  // while keeping every other Settings-page network request blocked.
  function tradeRelayFetch(input,init){
    const raw=typeof input==='string'?input:(input?.url||String(input||''));
    let req;
    try{req=new URL(String(raw),location.href)}catch{return Promise.reject(new TypeError('TRADE_RELAY_INVALID_URL'))}
    if(!tradeRelayAllowed(req) || req.hostname.toLowerCase()!=='script.google.com'){
      const e=new TypeError('TRADE_RELAY_BLOCKED: Yalnız kaydedilmiş Google Apps Script HTTPS relay adresine izin verilir.');
      e.code='TRADE_RELAY_BLOCKED';
      return Promise.reject(e);
    }
    return nativeFetch(input,init);
  }

  function allowed(url){
    let u;
    try{u=new URL(String(url),location.href);}catch{return false;}
    if (u.protocol !== 'https:') return true;
    const host=u.hostname.toLowerCase();
    if (runtimeBusy()) return true;
    if (marketLive() && NEWS_HOSTS.has(host)) return true;
    if (tradeRelayAllowed(u)) return true;
    return false;
  }

  globalThis.fetch = function aurumOfflineFetch(input, init){
    const url = typeof input==='string' ? input : (input?.url||String(input||''));
    if (allowed(url)) return nativeFetch(input, init);
    const e = new TypeError('OFFLINE_FIRST_BLOCKED: Bu modül yalnız yerel snapshot kullanır. Ağ erişimi yalnız zamanlanmış/manüel güncellemede açıktır.');
    e.code='OFFLINE_FIRST_BLOCKED';
    return Promise.reject(e);
  };

  // XHR is not used by the active provider runtime, but guard it as well.
  if (globalThis.XMLHttpRequest){
    const NativeXHR=globalThis.XMLHttpRequest;
    class GuardedXHR extends NativeXHR{
      open(method,url,...rest){
        this.__aurumUrl=String(url||'');
        if(!allowed(this.__aurumUrl)){
          const e=new DOMException('OFFLINE_FIRST_BLOCKED','NetworkError');
          throw e;
        }
        return super.open(method,url,...rest);
      }
    }
    globalThis.XMLHttpRequest=GuardedXHR;
  }

  // Prevent accidental page-open provider activity from looking like a sync.
  const oldGoPage=globalThis.goPage;
  if(typeof oldGoPage==='function'){
    globalThis.goPage=function(page){
      return oldGoPage(page);
    };
  }

  // Persist architecture marker inside this app's own sandbox only.
  try{
    localStorage.setItem('aurum.offline.architecture','REV20');
    localStorage.setItem('aurum.offline.package','com.aurum.rev20.standalone');
  }catch{}

  // Visible diagnostic for settings/debugging without changing the UI layout.
  globalThis.AurumOfflinePolicy=Object.freeze({
    version:'REV20.13',
    packageId:'com.aurum.rev20.standalone',
    mode:'INDEPENDENT_OFFLINE_FIRST',
    networkAllowed:allowed,
    tradeRelayFetch,
    rules:Object.freeze({ai:'NATIVE_SECURE',marketNews:'LIVE',companyNews:'LIVE',data:'SYNC_ONLY',tradeRelay:'SAVED_GOOGLE_APPS_SCRIPT_RUNTIME_GETTER_NATIVE_FETCH_ONLY',kn:'LOCAL_ONLY',historical:'LOCAL_ONLY',selection:'LOCAL_ONLY'})
  });
})();