(function R7Ui(){
  'use strict';
  if(globalThis.AurumR7Github)return;
  const WIDTH_KEY='aurum.ui.dataTimeWidth.v1';
  const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
  function getWidth(){let n=205;try{const v=Number(localStorage.getItem(WIDTH_KEY));if(Number.isFinite(v)&&v>=170&&v<=360)n=v}catch{}return n}
  function applyWidth(x){const n=Number(x);if(!Number.isFinite(n)||n<170||n>360)throw new Error('Veri Zamanı genişliği 170–360 px olmalı');document.documentElement.style.setProperty('--aurum-r7-time-width',Math.round(n)+'px');try{localStorage.setItem(WIDTH_KEY,String(Math.round(n)))}catch{}return n}
  function notify(message){if(typeof showAurumNotice==='function')showAurumNotice(message,'success',2500);else if(typeof showNotice==='function')showNotice(message)}
  function updateWidth(){try{applyWidth(document.getElementById('aurumGithubR7Width')?.value);notify('Veri Zamanı genişliği kaydedildi')}catch(e){alert(e.message)}}
  function classify(k){const x=k.toLowerCase();if(/provider|data|missing|fill|fetch|source|history|month|request|retry|timeout|quality|market|signal/.test(x))return 'Veri ve Kaynak';if(/stop|loss|risk|commission|slippage|position|liquidity|profit|exit|trade|order/.test(x))return 'İşlem ve Risk';if(/weight|learn|backtest|criterion|criteria|rank|topn|genome|behavior|threshold/.test(x))return 'Kriter ve Öğrenme';if(/time|schedule|interval|window|minute|daily|hour|calendar|export|sync/.test(x))return 'Zamanlama';return 'Diğer Ayarlar'}
  function settingsHtml(){
    const s=state?.settings||{},groups=new Map();
    for(const [k,v] of Object.entries(s)){
      if(v===null||typeof v==='object'||!['string','number','boolean'].includes(typeof v)||/secret|password|api.?key|token|auth|credential|license|private/i.test(k))continue;
      const group=classify(k);if(!groups.has(group))groups.set(group,[]);groups.get(group).push([k,v]);
    }
    const widthCard=`<details class="card gold-edge aurum-settings-details"><summary class="aurum-settings-summary"><div><strong>Veriler · Veri Zamanı</strong><small>Genişlik 170–360 px · varsayılan 205 px</small></div><span class="aurum-details-chevron">⌄</span></summary><div class="aurum-settings-details-body"><label class="field"><span>Veri Zamanı sütun genişliği (px)</span><input id="aurumGithubR7Width" type="number" min="170" max="360" step="5" value="${getWidth()}"></label><div class="actions"><button class="gold-btn" type="button" onclick="AurumR7Github.updateWidth()">Uygula</button></div></div></details>`;
    const fills=s.completionOptionalFillTargets;
    const values=Array.isArray(fills)&&fills.length===4?fills:[95,90,80,70];
    const thresholdCard=`<details class="card gold-edge aurum-settings-details"><summary class="aurum-settings-summary"><div><strong>Veriler · Eksikleri Tamamlama</strong><small>İlk tur zorunlu, sonra sırasıyla %95 / %90 / %80 / %70</small></div><span class="aurum-details-chevron">⌄</span></summary><div class="aurum-settings-details-body"><div class="form-grid">${values.map((v,i)=>`<label class="field"><span>Koşullu tur ${i+1} eşiği (%)</span><input type="number" min="0" max="100" step=".1" data-r7-target="${i}" value="${Number(v)}"></label>`).join('')}</div><p class="muted">Önce eşik; koşul sağlanırsa 30 dakika kontrolü: eski aktarımda tam, yenide sadece eksik taraması.</p><button class="gold-btn" type="button" onclick="AurumR7Github.saveSettings()">Eşikleri Kaydet</button></div></details>`;
    const categoryCards=[...groups].map(([name,fields])=>`<details class="card gold-edge aurum-settings-details"><summary class="aurum-settings-summary"><div><strong>${escape(name)} · Ek Ayarlar</strong><small>${fields.length} düzenlenebilir ayar</small></div><span class="aurum-details-chevron">⌄</span></summary><div class="aurum-settings-details-body"><div class="form-grid">${fields.map(([key,v])=>`<label class="field"><span>${escape(key)}</span>${typeof v==='boolean'?`<select data-r7-setting="${escape(key)}" data-type="boolean"><option value="true" ${v?'selected':''}>Açık</option><option value="false" ${!v?'selected':''}>Kapalı</option></select>`:`<input data-r7-setting="${escape(key)}" data-type="${typeof v}" type="${typeof v==='number'?'number':'text'}" ${typeof v==='number'?'step="any"':''} value="${escape(v)}">`}</label>`).join('')}</div><button class="gold-btn" type="button" onclick="AurumR7Github.saveSettings()">Kaydet</button></div></details>`).join('');
    const fundAi=typeof globalThis.AurumNativeAI?.request==='function'?'':`<details class="card gold-edge aurum-settings-details"><summary class="aurum-settings-summary"><div><strong>ChatGPT · AI ile Kod İnceleme</strong><small>Resmî ChatGPT sayfası · revizyon talimatını kopyala</small></div><span class="aurum-details-chevron">⌄</span></summary><div class="aurum-settings-details-body"><p>ChatGPT hesabıyla uygulama içi OAuth girişi henüz bulunmuyor. Bu bağlantı, API yetkilendirmesi sağlamaz.</p><a href="https://chatgpt.com/" target="_blank" rel="noopener noreferrer">ChatGPT giriş sayfası</a><label class="field"><span>Revizyon talimatı</span><textarea id="aurumGithubR7Prompt" rows="4"></textarea></label><button class="gold-btn" type="button" onclick="AurumR7Github.copyPrompt()">Talimatı Kopyala</button></div></details>`;
    return widthCard+thresholdCard+categoryCards+fundAi;
  }
  async function saveAdvancedSettings(){
    try{
      const next={...(state.settings||{})};
      for(const el of document.querySelectorAll('[data-r7-setting]')){
        const k=el.dataset.r7Setting;if(!(k in next))continue;
        const type=el.dataset.type;
        const v=type==='boolean'?el.value==='true':type==='number'?Number(el.value):el.value;
        if(type==='number'&&(!el.value.trim()||!Number.isFinite(v)))throw new Error('Geçersiz değer: '+k);
        next[k]=v;
      }
      const es=[...document.querySelectorAll('[data-r7-target]')];
      if(es.length===4){
        const v=es.map(e=>Number(e.value));
        if(v.some((n,i)=>!Number.isFinite(n)||n<0||n>100||(i>0&&n>v[i-1])))throw new Error('Eşikler azalan sırada ve 0–100 arasında olmalı');
        next.completionOptionalFillTargets=v;
      }
      if(typeof saveSettings==='function'){
        // FUND accepts the new settings object; BIST persists state.settings.
        state.settings=next;
        await Promise.resolve(saveSettings(next));
      }else{
        state.settings=next;
        if(typeof persistSettings==='function')await Promise.resolve(persistSettings(next));
      }
      notify('Ayarlar kaydedildi');
    }catch(e){alert(String(e?.message||e))}
  }
  function copyPrompt(){const v=String(document.getElementById('aurumGithubR7Prompt')?.value||'').trim();if(!v)return;try{navigator.clipboard.writeText(v).then(()=>notify('Talimat kopyalandı'))}catch{alert('Kopyalama kullanılamıyor')}}
  let queued=false;
  function tagTimeColumn(){
    const root=document.querySelector('#content[data-page="data"]');if(!root)return;
    const table=root.querySelector('#dataTable');if(!table)return;
    const ths=[...table.querySelectorAll('thead tr:first-child th')];let col=ths.findIndex(th=>/veri\s*zaman[ıi]|verizaman[ıi]|veri\s*tarihi|tarih\s*saat/i.test(th.textContent.trim().replace(/\s+/g,' ')));
    if(col<0&&table.classList.contains('fund-table'))col=1;
    if(col<0)return;
    for(const tr of table.querySelectorAll('tr')){const c=tr.children[col];if(c&&c.tagName==='TH'||c&&c.tagName==='TD')c.classList.add('aurum-r7-time-column')}
  }
  function scheduleTag(){if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;tagTimeColumn()})}
  applyWidth(getWidth());
  if(typeof settingsPage==='function'){const original=settingsPage;settingsPage=function aurumR7GithubSettings(){return settingsHtml()+original.apply(this,arguments)};globalThis.settingsPage=settingsPage;try{globalThis.settingsSub=settingsPage}catch{}}
  if(typeof document!=='undefined'){const root=document.getElementById('content')||document.body;if(root){new MutationObserver(scheduleTag).observe(root,{subtree:true,childList:true});scheduleTag()}}
  globalThis.AurumR7Github=Object.freeze({getWidth,applyWidth,updateWidth,saveSettings:saveAdvancedSettings,copyPrompt,tagTimeColumn});
})();
