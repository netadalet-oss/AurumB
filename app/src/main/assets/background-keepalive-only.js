'use strict';
/* Background continuity only. Does not alter transfer speed, concurrency, provider selection,
   retries, validation, staging, publication, calculations or any data-quality rule. */
(()=>{
 if(globalThis.__AURUM_BG_KEEPALIVE_ONLY__)return;globalThis.__AURUM_BG_KEEPALIVE_ONLY__=true;
 const keep=on=>{try{globalThis.AurumNativeCall?.('aurum://native?cmd=transfer_keepalive&enabled='+(on?'1':'0'),'')}catch{}};
 const busy=()=>{try{const r=typeof currentRuntime==='function'?currentRuntime():null;return !!(r&&!r.interrupted&&typeof operationBusyStatus==='function'&&operationBusyStatus(r.status))}catch{return false}};
 let held=false;
 const sync=()=>{const b=busy();if(b!==held){held=b;keep(b)}};
 globalThis.AurumTransferKeepalive=Object.freeze({sync,held:()=>held});
 /* Do not start any native service at application launch on the basis of a persisted
    busy status from a process that has already died. Only live runtime transitions
    may acquire a keepalive. */
 /* No polling/lifecycle trigger: runtime state transitions call sync directly. */
})();