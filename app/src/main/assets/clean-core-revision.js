'use strict';
(()=>{
 if(globalThis.__AURUM_CLEAN_CORE_REVISION__)return;globalThis.__AURUM_CLEAN_CORE_REVISION__='2026.09.29';
 function mountTradeLedger(){
  try{
   if(globalThis.state?.page!=='selection')return;
   const host=document.getElementById('content');if(!host||document.getElementById('aurumCleanTradeLedger'))return;
   const card=globalThis.AurumQualifiedBuySell?.card?.();if(!card)return;
   const box=document.createElement('section');box.id='aurumCleanTradeLedger';box.innerHTML=card;
   host.appendChild(box);
  }catch(e){console.warn('AL/SAT kalıcı görünüm kurulamadı',e)}
 }
 let pending=false;
 const scheduleMount=()=>{if(pending)return;pending=true;queueMicrotask(()=>{pending=false;mountTradeLedger()})};
 new MutationObserver(scheduleMount).observe(document.getElementById('content')||document.body,{childList:true,subtree:false});
 document.addEventListener('click',e=>{if(e.target?.closest?.('[data-page="selection"]'))setTimeout(mountTradeLedger,0)},true);
 setTimeout(mountTradeLedger,0);
})();