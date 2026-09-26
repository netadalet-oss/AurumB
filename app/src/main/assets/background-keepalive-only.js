'use strict';
/* Background continuity only. Does not alter transfer speed, concurrency, provider selection,
   retries, validation, staging, publication, calculations or any data-quality rule. */
(()=>{
 if(globalThis.__AURUM_BG_KEEPALIVE_ONLY__)return;globalThis.__AURUM_BG_KEEPALIVE_ONLY__=true;
 const keep=on=>{try{globalThis.AurumNativeCall?.('aurum://native?cmd=transfer_keepalive&enabled='+(on?'1':'0'),'')}catch{}};
 const busy=()=>{try{const r=typeof currentRuntime==='function'?currentRuntime():null;return !!(r&&typeof operationBusyStatus==='function'&&operationBusyStatus(r.status))}catch{return false}};
 let held=false;
 const sync=()=>{const b=busy();if(b!==held){held=b;keep(b)}};
 /* No polling/lifecycle trigger: keepalive is controlled by the authorized Veriler job itself. */
})();