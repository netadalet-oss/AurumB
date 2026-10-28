/* Aurum BIST — 2026-10-15 revision: verified local user-requested contract.
   Runs AFTER the existing runtime/compatibility layers. No remote executable code. */
'use strict';
(function(){
  const VERSION='2026.10.15-R3';
  const seats=['K1','K2','K3','K4','K5','K6','K7'];
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const safeNumber=v=>v===null||v===undefined||v===''?null:(Number.isFinite(Number(v))?Number(v):null);
  const pct=v=>v==null?'—':(100*v).toLocaleString('tr-TR',{minimumFractionDigits:2,maximumFractionDigits:2})+'%';
  // R8: original K_Tarihsel renderer and column layout remain authoritative.
  // K1–K7 hit-rate ordering is applied only inside original KnTrend cell.
  function settingsGroups(){
    const s=state?.settings||{},groups={
      'Veri ve Kaynak Ayarları':[], 'İşlem ve Risk Ayarları':[], 'Kriter / Öğrenme / Backtest':[], 'AI ve Denetim Ayarları':[], 'Zamanlama ve Aktarım':[], 'Diğer Uygulama Ayarları':[]
    };
    for(const [k,v] of Object.entries(s)){
      if(v===null||typeof v==='object'||!['string','number','boolean'].includes(typeof v)||/api.?key|secret|password|access.?token|refresh.?token|auth|credential|private|license|licensekey/i.test(k))continue;
      const lower=k.toLowerCase();const group=/provider|data|missing|fill|fetch|source|history|month|request|retry|timeout|fresh|quality|signal/i.test(lower)?'Veri ve Kaynak Ayarları':
        /stop|loss|risk|commission|slippage|position|liquidity|participation|profit|exit|trade|order/i.test(lower)?'İşlem ve Risk Ayarları':
        /weight|learn|backtest|criterion|criteria|rank|topn|genome|behavior|threshold|probation/i.test(lower)?'Kriter / Öğrenme / Backtest':
        /^(ai|openai)|audit|model|confidence/i.test(lower)?'AI ve Denetim Ayarları':
        /time|schedule|interval|window|minute|daily|hour|calendar|export|sync/i.test(lower)?'Zamanlama ve Aktarım':'Diğer Uygulama Ayarları';
      groups[group].push([k,v]);
    }
    return groups;
  }
  function extraSettingsMarkup(){
    const groups=settingsGroups(),old=state?.settings?.completionFillTargets,current=state?.settings?.completionOptionalFillTargets;
    const targets=Array.isArray(current)&&current.length===4?current:(Array.isArray(old)&&old.length===5?old.slice(1):[95,90,80,70]);
    const thresholdFields=Array.from({length:4},(_,i)=>`<label class="field"><span>Koşullu ${i+1}. tur · doluluk eşiği (%)</span><input type="number" step="0.01" min="0" max="100" data-aurum-completion-target="${i}" value="${Number(targets[i]??[95,90,80,70][i])}"></label>`).join('');
    const dataCard=`<details class="card gold-edge aurum-settings-details"><summary class="aurum-settings-summary"><div><strong>Veriler · Eksikleri Tamamlama Eşikleri</strong><small>İlk tur zorunlu · sonra %95, %90, %80, %70</small></div><span class="aurum-details-chevron" aria-hidden="true">⌄</span></summary><div class="aurum-settings-details-body"><div class="form-grid">${thresholdFields}</div><p class="muted">Her koşullu turda önce eşik denetlenir. Tur gerekliyse önceki aktarımdan itibaren geçen süreye göre 30 dakika altında eksik, 30 dakika ve üstünde tam tarama yapılır.</p><div class="actions"><button class="gold-btn" type="button" onclick="AurumRevision20261015.saveAdvancedSettings()">Eşikleri Kaydet</button></div></div></details>`;
    const categories=Object.entries(groups).map(([label,entries])=>`<details class="card gold-edge aurum-settings-details"><summary class="aurum-settings-summary"><div><strong>${esc(label)} · Ek Ayarlar</strong><small>${entries.length} düzenlenebilir anahtar · gizli bilgiler hariç</small></div><span class="aurum-details-chevron" aria-hidden="true">⌄</span></summary><div class="aurum-settings-details-body"><div class="form-grid">${entries.map(([key,value])=>`<label class="field"><span>${esc(key)}</span>${typeof value==='boolean'?`<select data-aurum-advanced="${esc(key)}" data-type="boolean"><option value="true" ${value?'selected':''}>Açık</option><option value="false" ${!value?'selected':''}>Kapalı</option></select>`:`<input data-aurum-advanced="${esc(key)}" data-type="${typeof value}" value="${esc(value)}" type="${typeof value==='number'?'number':'text'}" ${typeof value==='number'?'step="any"':''}>`}</label>`).join('')}</div><div class="actions"><button class="gold-btn" type="button" onclick="AurumRevision20261015.saveAdvancedSettings()">${esc(label)} Ayarlarını Kaydet</button></div></div></details>`).join('');
    return dataCard+categories;
  }
  async function saveAdvancedSettings(){
    const result={...state.settings};for(const x of document.querySelectorAll('[data-aurum-advanced]')){
      const key=x.dataset.aurumAdvanced,t=x.dataset.type;
      if(!(key in result))continue;
      let value;if(t==='boolean')value=x.value==='true';else if(t==='number'){
        if(x.value.trim()==='')throw new Error(key+' için sayı boş bırakılamaz');value=Number(x.value);if(!Number.isFinite(value))throw new Error(key+' için sayı geçersiz');
      }else value=x.value;
      result[key]=value;
    }
    const targetInputs=[...document.querySelectorAll('[data-aurum-completion-target]')];if(targetInputs.length===4){const targets=targetInputs.map(x=>Number(x.value));if(targets.some((x,i)=>!Number.isFinite(x)||x<0||x>100||(i>0&&x>targets[i-1])))throw new Error('Dört eşik 0–100 aralığında ve azalan sırada olmalıdır');result.completionOptionalFillTargets=targets;delete result.completionFillTargets;}
    state.settings=result;await saveSettings();showAurumNotice('Gelişmiş ayarlar kaydedildi','success',2400);
  }
  function aiModule(){const native=!!globalThis.AurumNativeAI;
    return `<details class="card gold-edge aurum-settings-details aurum-ai-legacy" id="aurumAiLegacy"><summary class="aurum-settings-summary"><div><strong>ChatGPT / OpenAI — AI ile Kod Taslağı ve İnceleme</strong><small>Hesap bağlantısı · AI kod taslağı · inceleme</small></div><span class="aurum-details-chevron" aria-hidden="true">⌄</span></summary><div class="aurum-settings-details-body"><p><strong>ChatGPT hesabıyla doğrudan uygulama içi oturum açma:</strong> resmî OAuth entegrasyonu olmadığı için mevcut değildir. ChatGPT giriş ekranını tarayıcıda açabilirsiniz; bu giriş uygulamaya API izni vermez.</p><div class="actions"><button class="ghost-btn" onclick="window.open('https://chatgpt.com','_blank','noopener,noreferrer')">Resmî ChatGPT Girişi</button><button class="ghost-btn" onclick="AurumRevision20261015.openApiKey()">OpenAI API Anahtarını Yönet</button></div><p><small>AI üzerinden kod inceleme/taslak üretimi, Android güvenli alanındaki isteğe bağlı OpenAI API anahtarı ile çalışır. Öneri hiçbir zaman otomatik çalıştırılmaz; imzalı APK olmadan kurulu uygulama ikili kodu değiştirilemez.</small></p><label class="field">İstenen geliştirme / hata düzeltme<textarea id="aurumAiPatchPrompt" rows="4" placeholder="Örn. veri aktarımında eksik alan stratejisini gözden geçir..."></textarea></label><div class="actions"><button class="gold-btn" onclick="AurumRevision20261015.reviewPatch()">AI'den Kod Taslağı Al</button></div><pre id="aurumAiPatchResult" style="max-height:350px;overflow:auto;white-space:pre-wrap;user-select:text"></pre><small>${native?'Android güvenli API köprüsü mevcut.':'Bu APK’de güvenli API köprüsü bulunamadı.'}</small></div></details>`;
  }
  function openApiKey(){try{return globalThis.AurumNativeAI?.openEditor?.()}catch(e){showAurumNotice(e.message,'error',3000)}}
  async function reviewPatch(){const el=document.getElementById('aurumAiPatchResult'),prompt=String(document.getElementById('aurumAiPatchPrompt')?.value||'').trim();if(!prompt)throw new Error('Geliştirme talebi gerekli');if(!globalThis.AurumNativeAI?.configured?.())throw new Error('OpenAI API anahtarını Android güvenli alanına ekleyin');
    el.textContent='AI taslak incelemesi çalışıyor…';try{
      const resp=await globalThis.AurumNativeAI.request('/v1/responses','POST',{model:'gpt-4.1-mini',store:false,instructions:'You are reviewing an Android WebView app. Provide a secure change plan and human-reviewed code diff in Turkish. Never claim to install APKs. No tokens or secrets.',input:`Aurum BIST revizyon isteği: ${prompt}\nKısıtlar: K1-K7 rolling hit average, minimum privilege, no remote executable patches. Return proposed changes only.`},120000);
      const obj=JSON.parse(resp?.body||'{}');el.textContent=(obj.output_text||obj.output?.flatMap?.(x=>(x.content||[]).map(y=>y.text||'')).join('\n')||resp.body||'').slice(0,16000);
    }catch(e){el.textContent='AI başarısız: '+e.message;throw e;}
  }
  if(typeof settingsPage==='function'){
    const original=settingsPage;settingsPage=function aurumSettingsComplete(){return original() + extraSettingsMarkup()};
    globalThis.settingsPage=settingsPage;globalThis.settingsSub=settingsPage;
  }
  globalThis.AurumRevision20261015=Object.freeze({version:VERSION,trendRows:(typeof trendRows==='function'?trendRows:null),saveAdvancedSettings,openApiKey,reviewPatch,settingsGroups});
})();
