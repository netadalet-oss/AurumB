'use strict';
/* Safe transfer acceleration: presentation/housekeeping only.
   Data acquisition semantics are untouched: no provider, retry, concurrency, wave,
   validation, staging, quality-gate, atomic-publish or calculation setting is changed. */
(()=>{
 if(globalThis.__AURUM_SAFE_TRANSFER_ACCEL__)return;globalThis.__AURUM_SAFE_TRANSFER_ACCEL__=true;
 const busy=()=>{try{const r=typeof currentRuntime==='function'?currentRuntime():null;return !!(r&&typeof operationBusyStatus==='function'&&operationBusyStatus(r.status))}catch{return false}};
 let last=0,pending=false;
 const old=globalThis.updateLiveStatus;
 if(typeof old==='function')globalThis.updateLiveStatus=function(...a){
   if(!busy())return old.apply(this,a);
   const n=performance.now();
   if(n-last>=180){last=n;return old.apply(this,a)}
   if(!pending){pending=true;setTimeout(()=>{pending=false;last=performance.now();try{old()}catch{}},190)}
 };
 /* Avoid background rendering work while Android is throttling the WebView.
    Durable staging and native keepalive continue independently. */
 const oldRender=globalThis.renderCurrentPagePreservingView;
 if(typeof oldRender==='function')globalThis.renderCurrentPagePreservingView=function(...a){
   if(document.hidden&&busy())return;
   return oldRender.apply(this,a);
 };
})();