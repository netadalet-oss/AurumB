'use strict';
/* REV20 native bridge v2.
   Native commands never surface as browser prompt dialogs when the Android bridge is present. */
(()=>{
  const originalPrompt=window.prompt.bind(window);
  const isNative=m=>typeof m==='string'&&m.startsWith('aurum://native?');
  const nativeCall=(message,body='')=>{
    const raw=String(message||''),payload=String(body??'');
    try{
      const bridge=globalThis.AurumNativeBridge;
      if(bridge&&typeof bridge.call==='function')return String(bridge.call(raw,payload)??'');
    }catch{}
    try{return originalPrompt(raw,payload)||''}catch{return''}
  };
  window.prompt=function(message,defaultValue=''){
    if(isNative(message))return nativeCall(message,defaultValue);
    return originalPrompt(message,defaultValue);
  };
  globalThis.AurumNativeCall=nativeCall;
  globalThis.__AURUM_NATIVE_BRIDGE_V2__='REV20.2';
})();