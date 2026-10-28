/* Aurum R9 – verified training gates, human review, and explicit AI evidence.
   This is a local decision-support model policy. Never executes AI-written code,
   never places broker orders and never installs an APK. */
(function(){
 'use strict';
 const PREVIEW=30,AUTO=60,KS=['K1','K2','K3','K4','K5','K6','K7'];
 const finite=x=>x!==null&&x!==undefined&&x!==''&&Number.isFinite(Number(x));
 const clamp=(x,a,b)=>Math.min(b,Math.max(a,x));
 function evidence(){
  const dates=[...new Set((state.records||[]).flatMap(r=>r?.series?.date||[]))].sort();
  const current=(state.records||[]);const archived=[];
  for(const row of (state.khArchive?.rows||[])){
   if(!row?.frozen||!row?.date||!row?.criteria)continue;
   const manual=String(row.archiveOrigin||row.source||'').includes('MANUAL')||String(row.source||'').includes('PIT');
   if(manual&&!(row.inputCutoff===row.date&&row.futureDataUsed===false&&row.pitAudit?.version==='R11'))continue;
   const next=dates.find(d=>d>row.date);if(!next)continue;
   const returns=new Map(current.map(r=>[r.sym,kh117DayReturn(r,next)]).filter(([,v])=>Number.isFinite(v)&&v>-99.5));
   if(returns.size<20)continue;
   const top=[...returns.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).slice(0,20);
   const winners=new Set(top.map(x=>x[0]));const sums={};let valid=true;
   for(const k of KS){const list=row.criteria[k]||[];
    if(list.length!==20||new Set(list.map(x=>x.sym)).size!==20||list.some(x=>!returns.has(x.sym))){valid=false;break}
    sums[k]={hitCount:list.filter(x=>winners.has(x.sym)).length,total:20,realAvg:list.reduce((s,x)=>s+returns.get(x.sym),0)/20};
   }
   if(valid)archived.push({...row,summaries:sums,learningOutcomeDate:next});
  }
  archived.sort((a,b)=>String(b.date).localeCompare(String(a.date)));
  const byForwardDay=new Map();for(const run of effectiveLearningRuns()){
   const day=String(run.signalTradingDate||run.createdAt||'').slice(0,10);
   if(day&&!byForwardDay.has(day))byForwardDay.set(day,run);
  }
  const forward=[...byForwardDay.values()];
  return {archived,forward,archiveDays:archived.length,forwardDays:forward.length};
 }
 function normalize(o){let sum=KS.reduce((s,k)=>s+Math.max(0,Number(o?.[k])||0),0);return Object.fromEntries(KS.map(k=>[k,sum?(Math.max(0,Number(o?.[k])||0)/sum):1/7]));}
 function proposal(ev){
  if(ev.archiveDays<PREVIEW&&ev.forwardDays<PREVIEW)return null;
  const history=ev.archived.slice(0,Math.max(PREVIEW,Math.min(60,ev.archiveDays)));
  const source=history.length>=PREVIEW?'ARCHIVED_K1_K7_REEL':'FORWARD_EVALUATED_RUNS';
  const old=normalize(state.performance?.championWeights||state.performance?.weights||BASE_WEIGHTS),strength={};
  for(const k of KS){
   const p=history.map(r=>r.summaries[k]).filter(s=>s&&finite(s.hitCount)&&Number(s.total)>0),hits=p.length?p.reduce((a,s)=>a+Number(s.hitCount)/Number(s.total),0)/p.length:null;
   const realized=p.filter(s=>finite(s.realAvg)).map(s=>Number(s.realAvg)),actual=realized.length?realized.reduce((a,b)=>a+b,0)/realized.length:null;
   const fw=ev.forward.slice(0,60).map(r=>r.criteria?.[k]||[]).filter(x=>x.length>0),fh=fw.length?fw.reduce((a,x)=>a+x.filter(t=>t.dualHit).length/x.length,0)/fw.length:null;
   const confidence=source==='ARCHIVED_K1_K7_REEL'?hits:fh;
   strength[k]={hitRate:confidence,realAvg:actual,samples:source==='ARCHIVED_K1_K7_REEL'?p.length:fw.length};
  }
  if(KS.some(k=>!finite(strength[k].hitRate)))return null;
  const avg=KS.reduce((sum,k)=>sum+strength[k].hitRate,0)/7;
  const raw={};for(const k of KS){const hit=Number(strength[k].hitRate),ret=strength[k].realAvg;
   /* A bounded change: 70% hit information, 30% actual return if available. */
   const signal=(hit-avg)*.7+(Number.isFinite(ret)?Math.tanh(ret/6)*.03:0);
   raw[k]=old[k]*clamp(1+signal,0.90,1.10);
  }
  const next=normalize(raw),latest=source==='ARCHIVED_K1_K7_REEL'?history[0]?.date:ev.forward[0]?.signalTradingDate;
  return {source,asOf:latest,archiveDays:ev.archiveDays,forwardDays:ev.forwardDays,old,proposed:next,statistics:strength,updatedAt:nowISO(),status:'USER_REVIEW_REQUIRED'};
 }
 function humanCard(){const ev=evidence(),p=proposal(ev),f=ev.forwardDays;
  const n=ev.archiveDays;
  const latest=state.performance?.pendingReview;
  const text=f>=AUTO?'60+ doğrulanmış ileri dönem: güvenlik/bağımsız testler geçerse ağırlıklar otomatik güncellenir.':n>=PREVIEW||f>=PREVIEW?'30+ doğrulanmış geçmiş dönem: değişiklik için kullanıcı onayı gerekir.':'Öğrenme için doğrulanmış tarihsel veri biriktiriliyor.';
  return `<div class="card gold-edge"><h3>Öğrenme önerisi</h3><div class="list-row"><strong>K_Tarihsel doğrulanmış gün</strong><span>${n}</span></div><div class="list-row"><strong>Bağımsız ileri dönem</strong><span>${f} / ${AUTO}</span></div><p class="muted">${text}</p>${p?`<div class="list-row"><small>Öneri kaynağı: ${p.source==='ARCHIVED_K1_K7_REEL'?'K1–K7 isabet ve reel sonuç':'İleri dönem sonuçları'} · ${p.asOf||'—'}</small></div><div class="weight-grid">${KS.map(k=>`<div><small>${k} · ${p.statistics[k].samples} dönem</small><b>${(100*p.proposed[k]).toFixed(2)}%</b></div>`).join('')}</div>${f<AUTO?`<div class="actions"><button class="gold-btn" onclick="aurumR9ApprovePreview()">30 gün önerisini incele ve onayla</button></div>`:''}`:''}<div class="actions"><button class="ghost-btn" onclick="aurumR9Rollback().catch(e=>showAurumNotice(e.message,'error',3500))">Son ağırlık değişimini geri al</button></div><small class="muted">Öncülden üretilen olasılıklar doğrulanmış hedef olasılığı sayılmaz. Buradaki otomatik değişiklik yalnız yerel K1–K7 model ağırlıklarını kapsar, yazılım kodunu/APK'yi veya aracı kurum emirlerini değil. Test başarısızsa ağırlıklar değişmez.</small>${latest?.status==='MANUALLY_APPROVED'?`<div class="notice">Son onay: ${latest?.approvedAt||'—'}</div>`:''}</div>`;
 }
 globalThis.aurumR9ApprovalStatus=()=>({archiveDays:evidence().archiveDays,forwardDays:evidence().forwardDays,review:proposal(evidence()),current:state.performance?.lastDecision});
 globalThis.aurumR9ApprovePreview=async function(){
  const ev=evidence(),candidate=proposal(ev);
  if(!candidate)throw new Error('30 doğrulanmış dönem henüz bulunmuyor');
  if(!confirm(`${ev.archiveDays} arşiv ve ${ev.forwardDays} ileri dönem kanıtına göre K1–K7 ağırlık önerisini küçük bir değişim sınırıyla uygulamak istiyor musunuz? Bu deneysel onaydır; 60 dönemlik otomatik doğrulama sayılmaz.`))return false;
  const old=normalize(state.performance.championWeights||state.performance.weights||BASE_WEIGHTS);
  const cap=Math.min(.01,Math.max(.001,Number(state.settings.weightDailyCapPct||1)/100));
  const next=projectWeights(candidate.proposed,old,state.performance.raw||{},cap);
  const backup={at:nowISO(),weights:old,source:'R9_30_USER_APPROVED',evidence:candidate};
  await dbPut('meta',{key:'r9ModelRollback',value:backup,updatedAt:backup.at});
  state.performance.weights=next;state.performance.championWeights=next;
  state.performance.lastDecision='R9_30_MANUAL_APPROVAL';state.performance.lastWeightUpdateDate=trParts().date;
  state.performance.pendingReview={...candidate,approvedAt:nowISO(),status:'MANUALLY_APPROVED'};
  state.performance.history=[{date:trParts().date,decision:'R9_30_MANUAL_APPROVAL',weights:{...next},source:candidate.source},...(state.performance.history||[])].slice(0,180);
  await dbPut('meta',{key:'performance',value:state.performance,updatedAt:nowISO()});
  if(typeof recordAIImpact==='function')await recordAIImpact({type:'30_GÜN_ONAY',change:'K1–K7 ağırlıkları kullanıcı tarafından onaylandı',criterion:KS.join(', '),previous:old,next,reason:'30 dönemlik doğrulanmış K_Tarihsel / ileri dönem önerisi; sınırlı ağırlık değişimi',outcome:'ONAYLANDI'});
  if(state.records?.length){const built=rebuildModelViews(globalThis.calculationRecords?.()||state.records.filter(isTruthEligible));state.scores=built.scores;state.selection=built.selection;state.modelBySym=built.bySym;await updateSelectionLifecycle();}
  render();showAurumNotice('30 gün önerisi kullanıcı onayıyla uygulandı','success',2800);return true;
 };
 globalThis.aurumR9Rollback=async function(){
  const m=(await dbGet('meta','r9PreAutoRollback'))?.value||(await dbGet('meta','r9ModelRollback'))?.value;
  if(!m?.weights)throw new Error('Geri alınabilir önceki ağırlık kaydı bulunamadı');
  if(!confirm('K1–K7 ağırlıkları son kayıtlı önceki sürüme döndürülsün mü?'))return false;
  const old=normalize(state.performance.championWeights||state.performance.weights||BASE_WEIGHTS);
  const previous=normalize(m.weights);state.performance.weights=previous;state.performance.championWeights=previous;
  state.performance.lastDecision='R9_GERİ_ALINDI';state.performance.lastWeightUpdateDate=trParts().date;
  await dbPut('meta',{key:'performance',value:state.performance,updatedAt:nowISO()});
  await recordAIImpact({type:'R9_ROLLBACK',change:'Öğrenme ağırlıkları önceki sürüme döndürüldü',previous:old,next:previous,criterion:KS.join(','),reason:'Kullanıcı talebi',outcome:'GERİ ALINDI'});
  if(state.records?.length){const built=rebuildModelViews(globalThis.calculationRecords?.()||state.records.filter(isTruthEligible));state.scores=built.scores;state.selection=built.selection;state.modelBySym=built.bySym;await updateSelectionLifecycle();}
  render();showAurumNotice('Önceki model ağırlıkları geri yüklendi','success',2400);return true;
 };
 const oldCompute=computePerformanceWeights;
 computePerformanceWeights=async function aurumR9Compute(){
  /* Never bypass 60 independent forward periods, even if old settings said 12 or 20. */
  const ahead=evidence();
  const effectiveCount=effectiveLearningRuns().length;
  /* The 60 threshold is 60 different market days, not 60 intraday runs. */
  state.settings.minWeightObservations=ahead.forwardDays>=AUTO?AUTO:Math.max(AUTO,effectiveCount+1);
  const old=normalize(state.performance?.championWeights||state.performance?.weights||BASE_WEIGHTS);
  const before=evidence();
  if(before.forwardDays>=AUTO&&before.forward[0]?.id!==state.performance?.lastLearningRunId){
    await dbPut('meta',{key:'r9PreAutoRollback',value:{at:nowISO(),weights:old,runId:before.forward[0]?.id||null},updatedAt:nowISO()});
  }
  const result=await oldCompute();
  const ev=evidence();
  if(ev.forwardDays>=AUTO&&state.performance?.lastDecision==='ONAYLANDI'){
   const next=normalize(state.performance.championWeights||state.performance.weights||BASE_WEIGHTS);
   if(KS.some(k=>Math.abs(old[k]-next[k])>1e-9)){
    await dbPut('meta',{key:'r9AutoPromotionRollback',value:{at:nowISO(),weights:old,observations:ev.forwardDays},updatedAt:nowISO()});
    await recordAIImpact({type:'60_GÜN_OTOMATİK',change:'K1–K7 ağırlıkları doğrulanarak otomatik güncellendi',previous:old,next,criterion:KS.join(','),reason:'60+ bağımsız ileri dönem; doğrulama/test ve günlük sınır geçildi',outcome:'UYGULANDI'});
   }
  }
  return result;
 };
 globalThis.computePerformanceWeights=computePerformanceWeights;
 const oldOverview=learningOverviewSub;
 learningOverviewSub=function aurumR9LearningOverview(){return humanCard()+oldOverview();};
 const oldAi=aiPage;
 aiPage=function aurumR9AIPage(){return oldAi();};
 const oldSnapshot=buildAISnapshot;
 buildAISnapshot=function aurumR9EvidenceSnapshot(){
  const out=oldSnapshot(),ev=evidence();
  out.learning={...(out.learning||{}),prelearning_approval_periods:PREVIEW,automatic_promotion_periods:AUTO,archived_k1_k7_days:ev.archiveDays,verified_forward_days:ev.forwardDays,automatic_requires_independent_validation:true};
  out.selection=(out.selection||[]).map(x=>{const r=state.selection?.find(z=>z.sym===x.sym)||{};return {...x,target_probability:r.probabilityCalibrated===true?x.target_probability:null,prior_probability_for_research:r.probabilityCalibrated===true?null:r.targetProbability,probability_calibrated:r.probabilityCalibrated===true,probability_observations:r.confidenceObservations??0,risk_dimensions:{market:r.marketRegime||null,price_atr_pct:r.atrPct??null,execution_risk:r.executionRisk??null,estimated_cost_pct:r.estimatedCostPct??null},warning_rules_evaluated:r.warningRulesEvaluated??7,warning_rules_triggered:r.warningRulesTriggered??(r.warnings||[]).length,warnings:r.warnings||[]};});
  out.data_quality={...(out.data_quality||{}),last_confirmed_table_transfer:TABLE_META?.data?.transfer||null};
  return out;
 };
 globalThis.buildAISnapshot=buildAISnapshot;
 const oldSave=globalThis.saveLearningSettings;
 if(typeof oldSave==='function')globalThis.saveLearningSettings=async function(){await oldSave();state.settings.minWeightObservations=Math.max(AUTO,Number(state.settings.minWeightObservations)||0);await saveSettings();};
 globalThis.AurumR9={version:'R9.0',reviewAt:PREVIEW,autoAt:AUTO,evidence,proposal};
})();
