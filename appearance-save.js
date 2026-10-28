/* Coalesce edits and serialize writes so an older response cannot replace a newer edit. */
window.BeeAutosave=(()=>{
 function create({read,write,onSaved=()=>{},onStatus=()=>{},delay=650,retryDelay=5000}){
  let revision=0,confirmed=0,inflight=null,timer=null,lastResult,disposed=false,failures=0;const waiters=[];
  function schedule(ms){clearTimeout(timer);if(!disposed)timer=setTimeout(pump,ms);}
  function settle(error){for(let i=waiters.length-1;i>=0;i--){const w=waiters[i];if(error||w.target<=confirmed){waiters.splice(i,1);error?w.reject(error):w.resolve(lastResult);}}}
  function pump(){
   clearTimeout(timer);timer=null;if(disposed||inflight||revision<=confirmed)return;
   const sent=revision;onStatus('saving');
   inflight=Promise.resolve().then(()=>read()).then(write).then(result=>{lastResult=result;confirmed=sent;failures=0;onSaved(result,{current:revision===sent});onStatus(revision===sent?'saved':'saving');settle();}).catch(error=>{onStatus('error',error);settle(error);schedule(error.status===429?Math.max(60000,retryDelay):Math.min(60000,retryDelay*2**Math.min(failures++,4)));}).finally(()=>{inflight=null;if(revision>confirmed&&!timer)schedule(waiters.length?0:delay);});
  }
  function mark(){revision++;onStatus('saving');schedule(delay);}
  function flush(){if(revision<=confirmed)return Promise.resolve(lastResult);const result=new Promise((resolve,reject)=>waiters.push({target:revision,resolve,reject}));pump();return result;}
  function dispose(){disposed=true;clearTimeout(timer);settle(new Error('Autosave stopped.'));}
  return {mark,flush,dispose};
 }
 return {create};
})();
