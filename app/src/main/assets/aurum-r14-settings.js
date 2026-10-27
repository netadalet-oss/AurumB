/* R16: preserve the ORIGINAL independent Settings cards and their layout.
   No regrouping by keyword. Only exact identical duplicate cards are filtered. */
'use strict';
(function(){
 if(window.__AURUM_R16_SETTINGS__)return;
 window.__AURUM_R16_SETTINGS__=true;
 function preserveOriginalCards(html){
   const temp=document.createElement('template');temp.innerHTML=String(html||'');
   // R7 width-control is intentionally removed; keep all other native cards unchanged.
   for(const bad of temp.content.querySelectorAll('#aurumR7TimeSettings'))bad.remove();
   const seen=new Set();
   for(const n of [...temp.content.children]){
     if(!n.matches?.('details.aurum-settings-details'))continue;
     const normalized=n.outerHTML.replace(/\s+/g,' ').trim();
     if(seen.has(normalized))n.remove();else seen.add(normalized);
   }
   // Only these two EXACTLY repeated maintenance actions are redundant;
   // preserve every other settings card, input, save action and layout.
   for(const signature of [
      'aurumRunAccuracyAudit(false).then(r=>writeLocal(\'aurumAccuracyUiLast\',r))',
      'aurumRunAccuracyAudit(true).then(r=>writeLocal(\'aurumAccuracyUiLast\',r))'
   ]){
      const found=[...temp.content.querySelectorAll('button[onclick]')].filter(b=>
        String(b.getAttribute('onclick')||'').replace(/\s+/g,'')===signature);
      if(found.length<2)continue;
      // Keep the original accuracy-audit card's action.
      const keeper=found.find(b=>/Veri ve Hesaplama Doğruluk Denetimi/.test(
        b.closest('details')?.querySelector('summary strong')?.textContent||''))||found[0];
      for(const btn of found)if(btn!==keeper)btn.remove();
   }
   const shell=document.createElement('div');shell.appendChild(temp.content);return shell.innerHTML;
 }
 const original=window.settingsPage||settingsPage;
 function settingsRestored(){
   const existing=String(original());
   const api=typeof aiApiSettingsModule==='function'?aiApiSettingsModule():'';
   return preserveOriginalCards(existing+api);
 }
 window.settingsPage=settingsRestored;
 try{settingsPage=settingsRestored}catch(e){console.warn('Aurum R16 settings binding',e)}
 window.settingsSub=settingsRestored;
})();
