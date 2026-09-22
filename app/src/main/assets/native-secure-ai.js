'use strict';
(function(){
  const pending=new Map();
  const nativePrompt=(cmd,params,body='')=>window.prompt('aurum://native?'+new URLSearchParams(Object.assign({cmd},params||{})).toString(),body);
  const api={
    configured(){try{return nativePrompt('secret_status')==='1'}catch{return false}},
    save(key){if(!/^sk-[A-Za-z0-9_-]{20,}$/.test(String(key||'').trim()))throw new Error('Geçersiz API anahtarı');return nativePrompt('secret_set',{},String(key).trim())==='OK'},
    remove(){return nativePrompt('secret_delete')==='OK'},
    openEditor(){return nativePrompt('secret_input')==='OPENED'},
    request(path,method,body,timeout){
      const id='nai-'+Date.now()+'-'+Math.random().toString(36).slice(2);
      return new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>{pending.delete(id);reject(new Error('Native AI zaman aşımı'))},timeout||180000);
        pending.set(id,{resolve,reject,timer});
        const accepted=nativePrompt('openai_request',{path,method:method||'GET',requestId:id},body==null?'':JSON.stringify(body));
        if(accepted!=='ACCEPTED'){clearTimeout(timer);pending.delete(id);reject(new Error('Native AI isteği kabul edilmedi'))}
      });
    },
    resolve(id,payload){
      const p=pending.get(id);if(!p)return;pending.delete(id);clearTimeout(p.timer);
      try{
        const x=JSON.parse(payload);
        if(!x.ok){
          let msg=x.error||'';
          if(!msg&&x.body){try{const b=JSON.parse(x.body);msg=b?.error?.message||b?.message||''}catch{}}
          return p.reject(new Error(msg||('OpenAI HTTP '+x.status)));
        }
        p.resolve(x);
      }catch(e){p.reject(e)}
    }
  };
  window.AurumNativeAI=Object.freeze(api);
  window.AurumNativeAIKeySaved=function(ok){
    if(ok){
      try{window.showAurumNotice?.('OpenAI API anahtarı Android güvenli alanına kaydedildi','success',2600)}catch{}
      try{window.renderCurrentPagePreservingView?.()}catch{try{window.render?.()}catch{}}
    }
  };
})();