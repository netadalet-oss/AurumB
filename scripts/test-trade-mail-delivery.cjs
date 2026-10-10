#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const runtime=fs.readFileSync('app/src/main/assets/runtime.js','utf8');
const start=runtime.indexOf('(function installR210TradeSafetyAndDelivery(){');
const end=runtime.indexOf('/* REV20.15',start);
assert.ok(start>=0&&end>start,'B trade delivery module not found');
const storage=new Map(),requests=[];
const email='notify@example.test',hook='https://script.google.com/macros/s/EXAMPLE/exec?token=example-token';
let accepted=false,gate=null,started=null;
const settings={tradeAlertEmail:email,tradeAlertWebhookUrl:hook};
const sandbox={
  URL,console,Date,settingsPage:()=>'',html:x=>String(x),
  state:{settings,selection:[]},dbPut:async()=>{},
  saveSettings:async()=>{},showAurumNotice:()=>{},
  localStorage:{
    getItem:k=>storage.has(k)?storage.get(k):null,
    setItem:(k,v)=>storage.set(k,String(v)),
    removeItem:k=>storage.delete(k)
  },
  setInterval:()=>0,queueMicrotask:()=>{},
  AurumNativeBridge:{call:()=> 'OK'},
  AurumNativeHTTP:{
    canHandle:()=>true,
    request:async url=>{
      const u=new URL(url),data=JSON.parse(u.searchParams.get('payload'));
      requests.push({url,event:data.event,recipient:data.recipient});
      if(started){started();started=null}
      if(gate){const g=gate;gate=null;await g}
      return {ok:true,status:200,text:async()=>JSON.stringify(
        accepted?{ok:true,status:'SENT'}:{ok:false,status:'RETRY_LATER'})};
    }
  }
};
sandbox.globalThis=sandbox;
vm.runInNewContext(runtime.slice(start,end),sandbox,{timeout:2000});
const delivery=sandbox.AurumTradeAlerts;
assert.ok(delivery?.sync&&delivery?.flush&&delivery?.outbox);
const state=x=>({items:x}),buy={sym:'AAA',status:'BUY',buyAt:'2026-10-10T09:00:00Z',buyPrice:100};
const sell={sym:'AAA',status:'SELL',sellAt:'2026-10-10T10:00:00Z',sellPrice:95};
const newerBuy={sym:'BBB',status:'BUY',buyAt:'2026-10-10T11:20:00Z',buyPrice:25};
const newerSell={sym:'CCC',status:'SELL',sellAt:'2026-10-10T11:21:00Z',sellPrice:30};
const watchdog=setTimeout(()=>{console.error('FAILED mail test timed out');process.exitCode=1},10000);
(async()=>{
  await delivery.sync(state({AAA:buy}));
  assert.equal(delivery.outbox().length,1);
  assert.equal(delivery.outbox()[0].delivery.emailAt,null,'failed relay must preserve event');
  storage.delete('aurum.trade.alert.last-list.r221');
  await delivery.sync(state({AAA:buy}));
  assert.equal(delivery.outbox().length,1,'crash after enqueue must not duplicate list event');
  accepted=true;
  await delivery.flush();
  assert.ok(delivery.outbox()[0].delivery.emailAt,'SENT confirmation must persist');
  assert.deepEqual([...requests[0].event.buys],['AAA']);
  assert.equal(requests[0].event.buyList[0].price,100);
  await delivery.sync(state({AAA:sell}));
  const last=requests.at(-1).event;
  assert.deepEqual([...last.sells],['AAA']);
  assert.deepEqual([...last.changes.addedSells],['AAA']);
  assert.deepEqual([...last.changes.removedBuys],['AAA']);
  assert.equal(last.sellList[0].price,95);
  // A complete large list must be split into independently acknowledged GETs.
  const many={};for(let i=0;i<45;i++){
    const code='T'+String(i).padStart(3,'0');
    many[code]={sym:code,status:'BUY',buyAt:'2026-10-10T11:00:00Z',buyPrice:i+10};
  }
  const n=requests.length;
  await delivery.sync(state(many));
  assert.equal(delivery.outbox().filter(x=>!x.delivery.emailAt).length,1,
    'large list awaiting remaining chunks must persist');
  await delivery.flush();
  assert.equal(delivery.outbox().filter(x=>!x.delivery.emailAt).length,0);
  const packet=requests.slice(n);
  assert.ok(packet.length>2,'large list must be chunked');
  assert.ok(packet.every(x=>x.url.length<=7200),'each native GET must respect URL bound');
  assert.equal(new Set(packet.map(x=>x.event.id)).size,packet.length,'part IDs must be idempotent');
  const buyCodes=new Set(packet.flatMap(x=>x.event.buys));
  assert.equal(buyCodes.size,45,'no symbols may be dropped while chunking');
  // HTTPS suspension: subsequent list changes must survive old queue flush.
  settings.tradeAlertWebhookUrl='';
  await delivery.sync(state({BBB:newerBuy}));
  settings.tradeAlertWebhookUrl=hook;
  let release;
  gate=new Promise(resolve=>release=resolve);
  const entered=new Promise(resolve=>started=resolve);
  const sending=delivery.flush();
  await entered;
  const next=delivery.sync(state({CCC:newerSell}));
  release();
  await Promise.all([sending,next]);
  assert.ok(delivery.outbox().some(x=>x.sellList?.some(y=>y.code==='CCC')
    &&!x.delivery.emailAt),'concurrent new event must remain queued');
  await delivery.flush();
  clearTimeout(watchdog);
  console.log('PASS B AL/SAT real list and delta, crash dedupe, retry, large payload, concurrent queue retention');
})().catch(e=>{clearTimeout(watchdog);console.error(e);process.exitCode=1});
