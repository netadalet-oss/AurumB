'use strict';
(()=>{
 const plus30=t=>{const m=String(t).match(/^(\d\d):(\d\d)$/);if(!m)return t;const n=(+m[1]*60 + +m[2]+30)%1440;return String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0')};
 function block(){
  let data='00:30,04:30,08:20,09:20,10:20,11:20,12:20,13:20,14:20,15:20,16:20,17:20,18:20,19:20,20:30,21:30,22:30,23:30';
  try{data=localStorage.getItem('aurum.ui.dataScheduleTimes')||data}catch{}
  let market=data.split(',').map(plus30).join(',');try{market=localStorage.getItem('aurum.ui.marketScheduleTimes')||market}catch{}
  return '<details class="card gold-edge aurum-settings-details"><summary class="aurum-settings-summary"><div><strong>Otomatik Zamanlayıcılar</strong><small>Veriler ve Piyasa + Finans Portalı birbirinden tamamen bağımsızdır.</small></div></summary><div class="aurum-settings-details-body"><h3>Veriler Otomatik Zamanlayıcısı</h3><label><input id="aurumDataScheduleEnabled" type="checkbox" checked> Açık</label><input id="aurumDataScheduleTimes" value="'+data+'" style="width:100%"><button type="button" class="gold-btn" onclick="localStorage.setItem(\'aurum.ui.dataScheduleTimes\',document.getElementById(\'aurumDataScheduleTimes\').value);AurumScheduleSettings.saveData()">Veriler zamanlayıcısını kaydet</button><h3>Piyasa + Finans Portalı Otomatik Zamanlayıcısı</h3><small>Varsayılan: Veriler saatlerinden 30 dakika sonra. Bu liste bağımsız olarak değiştirilebilir.</small><label><input id="aurumMarketScheduleEnabled" type="checkbox" checked> Açık</label><input id="aurumMarketScheduleTimes" value="'+market+'" style="width:100%"><button type="button" class="gold-btn" onclick="localStorage.setItem(\'aurum.ui.marketScheduleTimes\',document.getElementById(\'aurumMarketScheduleTimes\').value);AurumScheduleSettings.saveMarket()">Piyasa zamanlayıcısını kaydet</button></div></details>';
 }
 const install=()=>{const old=globalThis.settingsPage;if(typeof old==='function'&&!old.__dualSchedule){const fn=function(...a){return block()+old.apply(this,a)};fn.__dualSchedule=true;globalThis.settingsPage=fn}};
 install();setTimeout(install,0);
})();