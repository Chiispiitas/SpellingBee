// This is public configuration, never a server credential or customer password.
window.BeeClient=(()=>{
 const release=new URL(document.currentScript.src).searchParams.get('v')||'current';
 const frontendBase=new URL('./',document.currentScript.src).href;
 const apiBase='https://headless-iiwbgwtcvli-chiispiitas-140b.wix-site-host.com/api/';
 const authKey='spelling-bee-app:account-session:v1';
 const token=()=>localStorage.getItem(authKey)||'';
 const setToken=value=>localStorage.setItem(authKey,value);
 const clearToken=()=>localStorage.removeItem(authKey);
 async function request(path,body,access=token()){
  const headers=new Headers();if(access)headers.set('X-Requested-With',access);
  if(body!==undefined)headers.set('Content-Type','application/json');
  const response=await fetch(apiBase+path,{credentials:'omit',headers,...(body!==undefined?{method:'POST',body:JSON.stringify(body)}:{})});
  const data=await response.json().catch(()=>({success:false,error:'The server did not respond. Please try again.'}));
  if(!response.ok||data.success===false)throw Object.assign(new Error(data.error||'Please try again.'),{status:response.status});
  return data;
 }
 return Object.freeze({release,frontendBase,apiBase,token,setToken,clearToken,request});
})();
