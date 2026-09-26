'use strict';
/* REV20 v4 native market-data HTTP bridge.
   Only Android-side allowlisted HTTPS providers are reachable. */
(()=>{
  const pending=new Map();
  const allowed=new Set([
    'www.isyatirim.com.tr','isyatirim.com.tr',
    'static.altinkaynak.com',
    'query1.finance.yahoo.com','query2.finance.yahoo.com',
    'bigpara.hurriyet.com.tr','www.bigpara.hurriyet.com.tr',
    'web-paragaranti-pubsub.foreks.com',
    'stooq.com','www.stooq.com',
    'www.kap.org.tr','kap.org.tr',
    'www.borsaistanbul.com','borsaistanbul.com',
    'news.google.com','feeds.nos.nl','www.tcmb.gov.tr','tcmb.gov.tr',
    'script.google.com','script.googleusercontent.com',
    'borsamatik.com','www.borsamatik.com.tr','borsamatik.com.tr'
  ]);
  const canHandle=input=>{
    try{const u=new URL(String(input));return u.protocol==='https:'&&allowed.has(u.hostname.toLowerCase())}catch{return false}
  };
  class NativeHeaders{
    constructor(obj){this.map={};for(const [k,v] of Object.entries(obj||{}))this.map[String(k).toLowerCase()]=String(v??'')}
    get(k){return this.map[String(k||'').toLowerCase()]??null}
  }
  class NativeResponse{
    constructor(x){this.ok=!!x.ok;this.status=Number(x.status||0);this.url=String(x.url||'');this.headers=new NativeHeaders(x.headers||{});this._body=String(x.body??'')}
    async text(){return this._body}
    async json(){return JSON.parse(this._body)}
  }
  function request(url,opts={},timeout=15000){
    if(!canHandle(url))return Promise.reject(new Error('Native HTTP host izinli değil'));
    const id='nhttp-'+Date.now()+'-'+Math.random().toString(36).slice(2);
    const method=String(opts?.method||'GET').toUpperCase();
    const headers={...(opts?.headers||{})};
    if(opts?.referrer&&!headers.Referer&&!headers.referer)headers.Referer=opts.referrer;
    return new Promise((resolve,reject)=>{
      let settled=false;
      const finish=(fn,v)=>{if(settled)return;settled=true;pending.delete(id);try{opts?.signal?.removeEventListener?.('abort',onAbort)}catch{};fn(v)};
      const onAbort=()=>{try{globalThis.AurumNativeCall?.('aurum://native?'+new URLSearchParams({cmd:'http_cancel',requestId:id}),'')}catch{};finish(reject,new DOMException('Aborted','AbortError'))};
      if(opts?.signal?.aborted)return onAbort();
      try{opts?.signal?.addEventListener?.('abort',onAbort,{once:true})}catch{}
      pending.set(id,{resolve:x=>finish(resolve,new NativeResponse(x)),reject:e=>finish(reject,e)});
      const raw='aurum://native?'+new URLSearchParams({cmd:'http_request',requestId:id,url:String(url),method,timeout:String(timeout)}).toString();
      const accepted=globalThis.AurumNativeCall?.(raw,JSON.stringify({headers}))||'';
      if(accepted!=='ACCEPTED')finish(reject,new Error('Native veri isteği kabul edilmedi: '+(accepted||'yanıt yok')));
    });
  }
  function resolve(id,payload){
    const p=pending.get(String(id));if(!p)return;
    try{
      const x=JSON.parse(String(payload||'{}'));
      if(Number(x.status||0)===0&&x.error)return p.reject(new Error(String(x.error)));
      p.resolve(x);
    }catch(e){p.reject(e)}
  }
  globalThis.AurumNativeHTTP=Object.freeze({version:'REV20.20',canHandle,request,resolve});
})();