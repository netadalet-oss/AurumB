'use strict';
(()=>{
  if(globalThis.AurumOTAEngine)return;
  const SCHEMA='aurum-update/v3',SLOT='aurum.runtime.update.slot.v2',PENDING='aurum.runtime.update.pending.v2',HISTORY='aurum.runtime.update.history.v2',LAST_ERROR='aurum.runtime.update.lastError.v2',MAX_HISTORY=10;
  const read=(k,d=null)=>{try{const v=JSON.parse(localStorage.getItem(k)||'null');return v??d}catch{return d}};
  const write=(k,v)=>{localStorage.setItem(k,JSON.stringify(v));return v};
  const remove=k=>localStorage.removeItem(k);
  const now=()=>new Date().toISOString();
  const history=()=>{const x=read(HISTORY,[]);return Array.isArray(x)?x.slice(0,MAX_HISTORY):[]};
  const writeHistory=x=>write(HISTORY,(Array.isArray(x)?x:[]).slice(0,MAX_HISTORY));
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  async function hash(code){const b=new TextEncoder().encode(String(code||'')),h=await crypto.subtle.digest('SHA-256',b);return [...new Uint8Array(h)].map(x=>x.toString(16).padStart(2,'0')).join('')}
  function native(cmd,params,body){
    const q=new URLSearchParams(Object.assign({cmd:cmd},params||{})).toString(),uri='aurum://native?'+q;
    try{
      if(globalThis.AurumNativeBridge&&typeof globalThis.AurumNativeBridge.call==='function')return String(globalThis.AurumNativeBridge.call(uri,String(body??''))||'');
      return String(window.prompt(uri,String(body??''))||'');
    }catch{return 'ERR:NATIVE_BRIDGE_UNAVAILABLE'}
  }
  function signingMessage(pkg){
    const caps=Array.isArray(pkg&&pkg.capabilities)?pkg.capabilities.map(String).sort():[];
    return [SCHEMA,String(pkg&&pkg.version||''),String(Number(pkg&&pkg.minAppVersionCode||0)),String(Number(pkg&&pkg.maxAppVersionCode||0)),String(pkg&&pkg.sha256||'').toLowerCase(),caps.join(',')].join('\n');
  }
  function validate(pkg,ctx){
    if(!pkg||typeof pkg!=='object'||Array.isArray(pkg))throw new Error('Güncelleme dosyası geçerli paket değil');
    if(pkg.schema!==SCHEMA)throw new Error('Şema aurum-update/v3 olmalıdır');
    if(!/^[A-Za-z0-9._+-]{1,48}$/.test(String(pkg.version||'')))throw new Error('Geçerli sürüm gerekli');
    const min=Number(pkg.minAppVersionCode||0),max=Number(pkg.maxAppVersionCode||0),app=Number(ctx.appVersionCode||0);
    if(!Number.isSafeInteger(min)||min<1)throw new Error('minAppVersionCode gerekli');
    if(max&&(!Number.isSafeInteger(max)||max<min))throw new Error('maxAppVersionCode geçersiz');
    if(app<min)throw new Error('Bu güncelleme en az uygulama '+min+' gerektiriyor');
    if(max&&app>max)throw new Error('Bu güncelleme en fazla uygulama '+max+' ile uyumlu');
    if(typeof pkg.runtimeCode!=='string'||!pkg.runtimeCode.trim())throw new Error('runtimeCode gerekli');
    if(pkg.runtimeCode.length>750000)throw new Error('Güncelleme kodu 750 KB sınırını aşıyor');
    if(!/^[a-f0-9]{64}$/i.test(String(pkg.sha256||'')))throw new Error('SHA-256 alanı gerekli');
    if(typeof pkg.signature!=='string'||pkg.signature.length<32||pkg.signature.length>8192)throw new Error('APK imza anahtarıyla üretilmiş paket imzası gerekli');
    const caps=Array.isArray(pkg.capabilities)?pkg.capabilities.map(String):[];
    if(caps.length!==1||caps[0]!=='runtime-overlay')throw new Error('Desteklenmeyen güncelleme yeteneği');
    try{new Function('api','"use strict";\n'+pkg.runtimeCode+'\n//# sourceURL=aurum-update-syntax-check.js')}catch(e){throw new Error('JavaScript sözdizimi geçersiz: '+(e&&e.message||e))}
    return true;
  }
  async function verify(pkg,ctx){
    validate(pkg,ctx);
    if((await hash(pkg.runtimeCode)).toLowerCase()!==String(pkg.sha256).toLowerCase())throw new Error('SHA-256 doğrulaması başarısız');
    const identity=native('update_signing_identity');
    if(!/^[a-f0-9]{64}$/i.test(identity))throw new Error('Android imza kimliği doğrulanamadı');
    if(native('verify_update_signature',{signature:pkg.signature},signingMessage(pkg))!=='OK')throw new Error('Paket APK imza anahtarıyla doğrulanamadı');
    pkg.signer=identity.toLowerCase();return true;
  }
  function remember(pkg,status,message){
    const row=Object.assign({},pkg,{status:status||'VERIFIED',message:message||'',historyAt:now()});
    const rows=history().filter(x=>String(x&&x.sha256||'').toLowerCase()!==String(pkg&&pkg.sha256||'').toLowerCase());rows.unshift(row);writeHistory(rows);return row;
  }
  async function execute(pkg,ctx){
    await verify(pkg,ctx);
    const api=Object.freeze(ctx.api(pkg));
    const fn=new Function('api','"use strict";\n'+pkg.runtimeCode+'\n//# sourceURL=aurum-update-'+String(pkg.version).replace(/[^A-Za-z0-9._-]/g,'_')+'.js');
    const result=await fn(api),health=result&&typeof result.healthCheck==='function'?await result.healthCheck():true;
    if(health!==true)throw new Error(typeof health==='string'?health:'Güncelleme sağlık kontrolü başarısız');
    return true;
  }
  function cleanup(){try{const a=read(SLOT),p=read(PENDING);if(a&&a.schema!==SCHEMA)remove(SLOT);if(p&&p.schema!==SCHEMA)remove(PENDING);writeHistory(history().filter(x=>x&&x.schema===SCHEMA))}catch{}}
  async function apply(ctx){
    cleanup();const pending=read(PENDING),active=read(SLOT);
    if(pending){
      try{
        await execute(pending,ctx);const promoted=Object.assign({},pending,{activatedAt:now()});
        if(active)remember(active,'VERIFIED','');write(SLOT,promoted);remove(PENDING);remove(LAST_ERROR);remember(promoted,'ACTIVE','');return true;
      }catch(e){
        remove(PENDING);remember(pending,'REJECTED',e&&e.message||String(e));write(LAST_ERROR,{at:now(),version:pending&&pending.version||null,message:e&&e.message||String(e),fallback:active&&active.version||'EMBEDDED_CORE'});
        if(active){try{await execute(active,ctx)}catch{remove(SLOT)}}return false;
      }
    }
    if(!active)return true;
    try{await execute(active,ctx);remove(LAST_ERROR);remember(active,'ACTIVE','');return true}catch(e){
      remember(active,'REJECTED',e&&e.message||String(e));
      for(const f of history().filter(x=>x&&x.status!=='REJECTED'&&String(x.sha256||'').toLowerCase()!==String(active.sha256||'').toLowerCase())){
        try{await execute(f,ctx);write(SLOT,Object.assign({},f,{activatedAt:now()}));write(LAST_ERROR,{at:now(),version:active.version,message:e&&e.message||String(e),fallback:f.version});return false}catch{}
      }
      remove(SLOT);write(LAST_ERROR,{at:now(),version:active.version,message:e&&e.message||String(e),fallback:'EMBEDDED_CORE'});return false;
    }
  }
  async function importFile(file,ctx){
    if(!file)throw new Error('Güncelleme dosyası seçilmedi');if(file.size>1100000)throw new Error('Güncelleme dosyası 1.1 MB sınırını aşıyor');
    let pkg;try{pkg=JSON.parse(await file.text())}catch{throw new Error('Güncelleme dosyası geçerli JSON kapsayıcı değil')}
    await verify(pkg,ctx);
    if(!confirm((pkg.title||pkg.version||'Güncelleme')+' kriptografik olarak doğrulandı. Staging alanına alınarak yeniden başlatmada etkinleştirilsin mi?'))return false;
    pkg=Object.assign({},pkg,{importedAt:now()});write(PENDING,pkg);await verify(read(PENDING),ctx);remember(pkg,'STAGED','');
    if(typeof ctx.restorePoint==='function')await ctx.restorePoint('GÜNCELLEME ÖNCESİ · '+(pkg.version||'paket'),{skipConfirm:true});
    ctx.notice('Güncelleme staging alanına alındı: '+(pkg.title||pkg.version),'success',1800);setTimeout(()=>location.reload(),240);return true;
  }
  async function rollback(sha,ctx){
    if(!confirm('Bu güncelleme devre dışı bırakılsın mı? Kullanıcı verileri silinmeyecektir.'))return false;
    const key=String(sha||'').toLowerCase(),rows=history(),target=rows.find(x=>String(x&&x.sha256||'').toLowerCase()===key);if(!target)throw new Error('Geri alınacak güncelleme bulunamadı');
    const active=read(SLOT),isActive=!!(active&&String(active.sha256||'').toLowerCase()===key),remaining=rows.filter(x=>String(x&&x.sha256||'').toLowerCase()!==key&&x.status!=='REJECTED');writeHistory(remaining);remove(PENDING);
    if(isActive){let f=null;for(const x of remaining){try{await verify(x,ctx);f=x;break}catch{}}if(f)write(SLOT,Object.assign({},f,{activatedAt:now()}));else remove(SLOT)}
    remove(LAST_ERROR);ctx.notice('Güncelleme geri alındı: '+(target.title||target.version||''),'success',1800);setTimeout(()=>location.reload(),220);return true;
  }
  function embedded(){
    if(!confirm('Gömülü uygulama çekirdeğine dönülsün mü? Kullanıcı verileri korunacaktır.'))return false;
    const a=read(SLOT);if(a)remember(a,'VERIFIED','');remove(SLOT);remove(PENDING);remove(LAST_ERROR);setTimeout(()=>location.reload(),180);return true;
  }
  function render(ctx){
    const a=read(SLOT),p=read(PENDING),err=read(LAST_ERROR),rows=history().map(x=>'<div class="list-row"><div><strong>'+esc(x.title||x.version||'Güncelleme')+'</strong><small>'+esc(x.version||'—')+' · '+esc(x.status||'VERIFIED')+' · '+esc(x.historyAt||x.importedAt||'')+'</small></div><span class="badge '+(a&&a.sha256===x.sha256?'ok':'warn')+'">'+(a&&a.sha256===x.sha256?'AKTİF':x.status==='REJECTED'?'REDDEDİLDİ':'SAKLI')+'</span></div>').join('');
    return ctx.card('Uygulama Güncelleme','aurum-update/v3 · APK imzası · SHA-256 · staging/rollback','<div class="list-row"><div><strong>Yerel uygulama '+esc(ctx.appVersionName)+'</strong><small>'+(a?'Aktif OTA '+esc(a.version):'Gömülü çekirdek etkin')+(p?' · staging '+esc(p.version):'')+'</small></div><span class="badge '+(a?'ok':'warn')+'">v'+esc(ctx.appVersionCode)+'</span></div><p class="muted">OTA paketleri yalnız bu APK’yı imzalayan anahtarın kriptografik imzasıyla kabul edilir. Paket staging, SHA-256, sürüm uyumluluğu, JavaScript sözdizimi ve sağlık kontrolünü geçmeden aktif olmaz. Hata halinde önceki doğrulanmış paket veya gömülü çekirdek korunur.</p><div class="actions"><button class="gold-btn" type="button" onclick="document.querySelector(\'#updatePackageInput\').click()">İmzalı Güncelleme Dosyası Seç</button>'+(a||p?'<button class="ghost-btn" type="button" onclick="rollbackEmbeddedCore()">Gömülü Çekirdeğe Dön</button>':'')+'</div>'+(err?'<div class="card notice"><b>Son aktivasyon reddedildi</b><small>'+esc(err.version||'')+' · '+esc(err.message||'')+' · fallback: '+esc(err.fallback||'')+'</small></div>':'')+'<details class="aurum-inner-details"><summary>Güncelleme geçmişi ('+history().length+'/'+MAX_HISTORY+')</summary>'+(rows||'<p class="muted">Henüz doğrulanmış güncelleme paketi yok.</p>')+'</details>','aurumUpdateModule');
  }
  globalThis.AurumOTAEngine=Object.freeze({schema:SCHEMA,verify,execute,apply,importFile,rollback,embedded,render,signingMessage});
})();
