window.BeeProduct = (()=>{
 const nativeFetch=window.fetch.bind(window),params=new URLSearchParams(location.search);
 const guestKey='bee-guest-access:'+location.pathname;
 const token=params.get('access')||sessionStorage.getItem(guestKey)||BeeClient.token();
 if(params.has('access'))sessionStorage.setItem(guestKey,token);
 const api=async path=>{const r=await nativeFetch(BeeClient.apiBase+path,{credentials:'omit',headers:token?{'X-Bee-Access':token}:{}});const data=await r.json();if(!r.ok||data.success===false)throw new Error(data.error||'Please sign in.');return data;};
 const dataCache=new Map();let scope='',settings={};
 async function wordList(level,difficulty){const k=level+'|'+difficulty;if(!dataCache.has(k))dataCache.set(k,api('word-list?level='+encodeURIComponent(level)+'&difficulty='+difficulty).then(d=>d.words).catch(e=>{dataCache.delete(k);throw e;}));return dataCache.get(k);}
 window.fetch=async(input,init={})=>{
   const url=new URL(typeof input==='string'?input:input.url,location.href);
   if(url.origin===location.origin){
     const match=url.pathname.match(/\/(wordlists|word-data)\/([^/]+)\/([^/.]+)\.(txt|json)$/);
     if(match){try{const words=await wordList(decodeURIComponent(match[2]),match[3]);const data=match[1]==='wordlists'?words.map(w=>w.word).join('\n'):JSON.stringify(Object.fromEntries(words.map(w=>[w.word,{definition:w.definition,example:w.example,ipa:w.ipa,audio:w.audio}])));return new Response(data,{headers:{'Content-Type':match[4]==='txt'?'text/plain':'application/json'}});}catch(e){return new Response(JSON.stringify({error:e.message}),{status:503});}}
   }
   if(url.origin===new URL(BeeClient.apiBase).origin&&url.pathname.startsWith('/api/')){const headers=new Headers(init.headers||{});if(token)headers.set('X-Bee-Access',token);init={...init,credentials:'omit',headers};}
   return nativeFetch(input,init);
 };
 const storage={getItem:k=>localStorage.getItem(scope+k),setItem:(k,v)=>localStorage.setItem(scope+k,v),removeItem:k=>localStorage.removeItem(scope+k)};
 class Channel extends BroadcastChannel{constructor(name){super(scope+name);}}
 const escape=value=>String(value||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function standby(){return `<div class="centered-layout standby-layout"><div class="standby-rotation"><div class="standby-set standby-school" data-standby="school"><img class="standby-logo" src="${escape(settings.logo||(BeeClient.frontendBase+'brand.svg'))}" alt="School logo"><h1 class="headline">${escape(settings.schoolName)}</h1>${settings.tagline?`<p>${escape(settings.tagline)}</p>`:''}</div><div class="standby-set standby-partners" data-standby="partners">${(settings.partners||[]).map(src=>`<img class="standby-partner-logo" src="${escape(src)}" alt="Partner logo">`).join('')}</div></div></div>`;}
 function brand(){
   const r=document.documentElement,light=settings.theme==='ivory';
   for(const [k,v] of Object.entries({'--bg':settings.background,'--product-bg':settings.background,'--accent':settings.accent,'--gold':settings.accent,'--fg':light?'#213043':'#f4f7fb','--muted':light?'#53667a':'#abb9cb','--panel':light?'#ffffff':'#162538','--control-card':light?'#ffffff':'#162538','--product-font':{modern:'system-ui, sans-serif',classic:'Georgia, serif',rounded:'ui-rounded, system-ui, sans-serif'}[settings.font]}))r.style.setProperty(k,v);
   if(settings.motion==='reduced')r.dataset.motion='reduced';
   document.querySelectorAll('img').forEach(img=>{if(img.closest('.english-brand')||img.classList.contains('english-brand')){img.src=settings.secondaryLogo||(BeeClient.frontendBase+'brand.svg');img.hidden=!settings.secondaryLogo;}else if(!img.closest('.standby-partners'))img.src=settings.logo||(BeeClient.frontendBase+'brand.svg');});
   document.querySelectorAll('.school-brand strong,[data-product-school]').forEach(el=>el.textContent=settings.schoolName);
   document.querySelectorAll('.event-bug>span').forEach(el=>el.textContent=settings.eventName);
   document.querySelectorAll('.control-brand').forEach(el=>{el.querySelector('img').src=settings.logo||(BeeClient.frontendBase+'brand.svg');if(!el.querySelector('.product-brand-name')){const name=document.createElement('span');name.className='product-brand-name';name.textContent=settings.schoolName;el.append(name);}});
   if(!document.getElementById('product-back')&&!location.pathname.endsWith('screen.html')){const a=document.createElement('a');a.id='product-back';a.href=BeeClient.frontendBase;a.textContent='← Dashboard';document.body.append(a);}
 }
 async function speak(word,level,difficulty){
   speechSynthesis.cancel();const row=(await wordList(level,difficulty)).find(w=>w.word===word.toLowerCase());
   if(row?.audio){const sound=new Audio(row.audio);await sound.play();return;}
   if(!window.speechSynthesis)throw new Error('This browser cannot speak words. Add an audio link to the list.');
   const speech=new SpeechSynthesisUtterance(word);speech.lang='en-US';speech.rate=.85;const voices=speechSynthesis.getVoices();speech.voice=voices.find(v=>v.lang==='en-US')||voices.find(v=>v.lang.startsWith('en'))||null;speech.volume=1;speechSynthesis.speak(speech);
 }
 async function start(scripts){
   try{
    const ctx=await api('context');settings=ctx.settings;scope='spelling-bee-app:'+ctx.account.id+':';window.BeeProduct.settings=settings;
    if(ctx.role==='screen'&&!location.pathname.endsWith('screen.html'))throw new Error('Open the screen link provided by your school.');
    if(ctx.role==='judge'&&!location.pathname.endsWith('judge.html'))throw new Error('Open the judge link provided by your school.');
    if(ctx.code&&!params.get('session')){params.set('session',ctx.code);history.replaceState(null,'',location.pathname+'?'+params.toString());}
    for(const script of scripts){const el=document.createElement('script');if(script.src){el.src=script.src;await new Promise((resolve,reject)=>{el.onload=resolve;el.onerror=()=>reject(new Error('The competition could not load. Please refresh.'));document.body.append(el);});}else{el.textContent=script.code;document.body.append(el);}}
    brand();
   }catch(e){document.body.replaceChildren();const main=document.createElement('main');main.className='product-access-error';const h=document.createElement('h1');h.textContent='Spelling Bee App';const p=document.createElement('p');p.textContent=e.message;const a=document.createElement('a');a.href=BeeClient.frontendBase;a.textContent='Go to sign in';main.append(h,p,a);document.body.append(main);}
 }
 return {start,storage,Channel,settings,standby,speak};
})();
