'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('app/src/main/assets/runtime.js','utf8');
const a=source.indexOf('(function installR210TradeSafetyAndDelivery(){'),b=source.indexOf('/* REV20.15',a);
assert.ok(a>=0&&b>a,'Trade delivery module bounds');
const values=new Map(),requests=[];let reply={ok:true,status:'SENT'};
const url='https://script.google.com/macros/s/EXAMPLE/exec?token=T';
const state={settings:{tradeAlertEmail:'alerts@example.test',tradeAlertWebhookUrl:url},selection:[]};
const mock={console:{warn(){}},URL,URLSearchParams,Date,structuredClone,state,
  localStorage:{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,String(v))},
  setInterval:()=>null,queueMicrotask:()=>null,
  AurumNativeBridge:{call:()=> 'OK'},
  AurumNativeHTTP:{canHandle:()=>true,request:async uri=>{
    requests.push(JSON.parse(new URL(uri).searchParams.get('payload')));
    return {ok:true,status:200,text:async()=>JSON.stringify(reply)}
  }},
  dbPut:async()=>{},dbGet:async()=>{},saveSettings:async()=>{},
  settingsPage:()=>'',now:()=>new Date().toISOString(),
  showAurumNotice:()=>{},AurumUpdateAPI:{state:{}},html:v=>v,
  document:{getElementById:()=>null},
  AurumPortfolio:{state:()=>({holdings:{},transactions:[]})},
  AurumQualifiedBuySell:{state:()=>({items:{}}),advance:async()=>({buys:[],sells:[]})}
};
vm.createContext(mock);
vm.runInContext(source.slice(a,b),mock,{timeout:3000});
const api=mock.AurumTradeAlerts;
const item=(code,side,price)=>({items:{[code]:{
  sym:code,status:side,buyAt:'2026-10-10T07:00:00Z',
  sellAt:'2026-10-10T08:30:00Z',buyPrice:price,sellPrice:price
}}});
(async()=>{
  await api.sync(item('ABC','BUY',100),{id:'initial'});
  assert.equal(requests.length,1,'first AL list must send');
  assert.equal(requests[0].event.buyList[0].price,100,'buy price must travel');
  await api.sync(item('ABC','BUY',100),{id:'unchanged'});
  assert.equal(requests.length,1,'unchanged list must not be resent');
  await api.sync(item('ABC','SELL',97),{id:'stop'});
  assert.equal(requests.length,2);
  assert.deepEqual(Array.from(requests[1].event.changes.addedSells),['ABC']);
  assert.deepEqual(Array.from(requests[1].event.changes.removedBuys),['ABC']);
  reply={ok:true,status:'OK_WITHOUT_SEND'};
  await api.sync(item('DEF','BUY',20),{id:'unconfirmed'});
  assert.equal(api.outbox().filter(x=>!x.delivery.emailAt).length,1,
    'unconfirmed relay response must retain pending notification');
  reply={ok:true,status:'SENT'};
  const delivered=await api.flush();
  assert.equal(delivered.pending,0,'retry must drain acknowledged events');
  assert.equal(api.outbox().filter(x=>!x.delivery.emailAt).length,0);
  console.log('PASS real AL/SAT list payload, diff, dedupe, no false SENT and retry');
})().catch(e=>{console.error(e);process.exitCode=1});
