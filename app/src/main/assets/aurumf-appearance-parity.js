'use strict';
/* AurumF appearance parity for AurumB. Isolated to Settings presentation only. */
(function(){
 if(window.__AURUMF_COLOR_STUDIO)return;window.__AURUMF_COLOR_STUDIO=1;
 const K='aurumf.colorStudio.v1';
 const AREAS=[
 ['bg','Genel arka plan','#000526','--af-theme-bg'],
 ['surface','Genel arayüz','#030a22','--af-theme-surface'],
 ['card','Kartlar','#030a22','--af-theme-card'],
 ['border','Kart / çizgi','#203052','--af-theme-border'],
 ['text','Ana yazı','#f5f7fb','--af-theme-text'],
 ['muted','İkincil yazı','#9cabc1','--af-theme-muted'],
 ['accent','Vurgu / altın','#d4af37','--af-theme-accent'],
 ['header','Üst başlık','#01083b','--af-theme-header'],
 ['nav','Alt navigasyon','#030a22','--af-theme-nav'],
 ['tableHead','Tablo başlığı','#071738','--af-theme-table-head'],
 ['tableBody','Tablo gövdesi','#020718','--af-theme-table-body'],
 ['button','Buton yüzeyi','#071733','--af-theme-button'],
 ['input','Giriş / arama','#010612','--af-theme-input'],
 ['positive','Pozitif / yükseliş','#35d49a','--af-theme-positive'],
 ['negative','Negatif / düşüş','#ff727c','--af-theme-negative']
 ];
 const defaults=Object.fromEntries(AREAS.map(x=>[x[0],x[2]]));
 const read=()=>{try{const x=JSON.parse(localStorage.getItem(K)||'null');return x&&typeof x==='object'?{...defaults,...x}:null}catch{return null}};
 let saved=read(),draft={...(saved||defaults)};
 const hexToHsl=h=>{let r=parseInt(h.slice(1,3),16)/255,g=parseInt(h.slice(3,5),16)/255,b=parseInt(h.slice(5,7),16)/255,max=Math.max(r,g,b),min=Math.min(r,g,b),H=0,S=0,L=(max+min)/2,d=max-min;if(d){S=d/(1-Math.abs(2*L-1));if(max===r)H=60*(((g-b)/d)%6);else if(max===g)H=60*((b-r)/d+2);else H=60*((r-g)/d+4)}if(H<0)H+=360;return[H,S*100,L*100]};
 const hslToHex=(h,s,l)=>{s/=100;l/=100;let c=(1-Math.abs(2*l-1))*s,x=c*(1-Math.abs((h/60)%2-1)),m=l-c/2,r=0,g=0,b=0;if(h<60)[r,g,b]=[c,x,0];else if(h<120)[r,g,b]=[x,c,0];else if(h<180)[r,g,b]=[0,c,x];else if(h<240)[r,g,b]=[0,x,c];else if(h<300)[r,g,b]=[x,0,c];else[r,g,b]=[c,0,x];return'#'+[r,g,b].map(v=>Math.round((v+m)*255).toString(16).padStart(2,'0')).join('')};
 const applyOne=(k,v)=>{const a=AREAS.find(x=>x[0]===k);if(a)document.documentElement.style.setProperty(a[3],v)};
 const applyAll=o=>{AREAS.forEach(a=>applyOne(a[0],o[a[0]]));document.documentElement.dataset.afColorTheme='1'};
 const clearAll=()=>{AREAS.forEach(a=>document.documentElement.style.removeProperty(a[3]));delete document.documentElement.dataset.afColorTheme};
 if(saved)applyAll(saved); // no saved preference => AurumF's existing visual defaults remain byte-for-byte in effect
 function row(a){let[k,n]=a,[h,s,l]=hexToHsl(draft[k]);return `<div class="af-color-row" data-af-color-row="${k}"><span class="af-color-name">${n}</span><i class="af-color-preview" style="--pv:${draft[k]}" title="Önizleme"></i><input class="af-color-hue" type="range" min="0" max="360" step="1" value="${Math.round(h)}" aria-label="${n} renk"><button class="af-color-def" data-af-color-def="${k}" type="button">Varsayılan</button><button class="af-color-save" data-af-color-save="${k}" type="button">Kaydet</button></div>`}
 function mount(){
  if(document.querySelector('.af-color-studio'))return;
  const content=document.querySelector('#content');if(!content||content.dataset.page!=='settings')return;
  const details=[...content.querySelectorAll(':scope > details.card, :scope > details.aurum-settings-details, details.card.aurum-settings-details')];
  const host=details[0]?.parentElement||content;
  const d=document.createElement('details');d.className='card aurum-settings-details af-color-studio';d.setAttribute('ontoggle','if(window.aurumAccordionToggle)aurumAccordionToggle(this)');
  d.innerHTML=`<summary class="aurum-settings-summary"><div class="af-color-summary"><strong>Gelişmiş Renk ve Tema</strong><small>Alan bazlı renk · ton · önizleme · varsayılan · kaydet</small></div><span class="aurum-details-chevron">∨</span></summary><div class="aurum-settings-details-body af-color-body"><small>Renk değişiklikleri anlık önizlenir. Kaydet yalnız renk tercihini kalıcılaştırır; diğer uygulama ayarlarına dokunmaz.</small>${AREAS.map(row).join('')}<div class="af-color-all"><button class="ghost-btn" data-af-color-all-default type="button">Tümü varsayılan</button><button class="gold-btn" data-af-color-all-save type="button">Tümünü kaydet</button></div></div>`;
  if(details[0])host.insertBefore(d,details[0]);else host.prepend(d);
 }
 function updateRow(r){const k=r.dataset.afColorRow,h=+r.querySelector('.af-color-hue').value,[,s,l0]=hexToHsl(draft[k]);const v=hslToHex(h,78,l0);draft[k]=v;r.querySelector('.af-color-preview').style.setProperty('--pv',v);applyAll(draft)}
 document.addEventListener('input',e=>{const r=e.target.closest?.('.af-color-row');if(r&&e.target.matches('.af-color-hue'))updateRow(r)},true);
 document.addEventListener('click',e=>{
  const def=e.target.closest?.('[data-af-color-def]');if(def){const k=def.dataset.afColorDef,a=AREAS.find(x=>x[0]===k),r=def.closest('.af-color-row'),[h]=hexToHsl(a[2]);draft[k]=a[2];r.querySelector('.af-color-hue').value=Math.round(h);r.querySelector('.af-color-preview').style.setProperty('--pv',a[2]);applyAll(draft);return}
  const save=e.target.closest?.('[data-af-color-save]');if(save){const k=save.dataset.afColorSave;saved={...(saved||defaults),[k]:draft[k]};localStorage.setItem(K,JSON.stringify(saved));save.classList.add('ok');setTimeout(()=>save.classList.remove('ok'),450);return}
  if(e.target.closest?.('[data-af-color-all-default]')){saved=null;draft={...defaults};localStorage.removeItem(K);clearAll();document.querySelector('.af-color-studio')?.remove();mount();return}
  if(e.target.closest?.('[data-af-color-all-save]')){saved={...draft};localStorage.setItem(K,JSON.stringify(saved));applyAll(saved);return}
 },true);
 new MutationObserver(mount).observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['class']});queueMicrotask(mount);

 /* Scroll-intent guard: a vertical swipe never becomes a color action. */
 let scrollGesture=false,sx=0,sy=0;
 document.addEventListener('pointerdown',e=>{if(!e.target.closest?.('.af-color-studio'))return;scrollGesture=false;sx=e.clientX;sy=e.clientY},{capture:true,passive:true});
 document.addEventListener('pointermove',e=>{if(!e.target.closest?.('.af-color-studio'))return;if(Math.abs(e.clientY-sy)>8&&Math.abs(e.clientY-sy)>Math.abs(e.clientX-sx)){scrollGesture=true}}, {capture:true,passive:true});
 document.addEventListener('click',e=>{if(scrollGesture&&e.target.closest?.('.af-color-studio button')){e.preventDefault();e.stopImmediatePropagation();scrollGesture=false}},true);
})();