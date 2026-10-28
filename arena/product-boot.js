window.BeeProduct = (()=>{
 const nativeFetch=window.fetch.bind(window),params=new URLSearchParams(location.search);
 const standaloneStudy=location.pathname.endsWith('/arena/index.html');
 const isAdmin=location.pathname.endsWith('/arena/admin.html');
 const privatePreview=params.has('preview')&&!!BeeClient.token();
 const guestRole=standaloneStudy?'study':location.pathname.endsWith('/judge.html')?'judge':'screen';
 const guestKey='bee-guest-access:'+guestRole;
 let token=isAdmin||privatePreview?BeeClient.token():'';
 async function guestAccess(){
   let code=params.get('code')||params.get('session')||sessionStorage.getItem('bee-school-code')||'';
   if(!code){
     code=await new Promise(resolve=>{
       document.body.replaceChildren();const main=document.createElement('main');main.className='product-access-error';
       const h=document.createElement('h1');h.textContent='Spelling Bee App';const form=document.createElement('form');
       const label=document.createElement('label');label.textContent='School session code';const input=document.createElement('input');input.inputMode='numeric';input.pattern='[0-9]{1,16}';input.required=true;input.autocomplete='off';label.append(input);
       const button=document.createElement('button');button.textContent='Continue';button.type='submit';form.append(label,button);main.append(h,form);document.body.append(main);
       form.onsubmit=e=>{e.preventDefault();resolve(input.value.trim());};
     });
     params.set('code',code);location.replace(location.pathname+'?'+params.toString());return false;
   }
   const r=await nativeFetch(BeeClient.apiBase+'guest-access',{method:'POST',credentials:'omit',headers:{'Content-Type':'application/json'},body:JSON.stringify({code,role:guestRole})});
   const data=await r.json();if(!r.ok)throw new Error(data.error||'Session code not found.');token=data.token;
   sessionStorage.setItem('bee-school-code',code);
   params.delete('access');if(standaloneStudy)params.delete('session');
   history.replaceState(null,'',location.pathname+'?'+params.toString());return true;
 }
 const api=async path=>{const r=await nativeFetch(BeeClient.apiBase+path,{credentials:'omit',headers:token?{'X-Requested-With':token}:{}});const data=await r.json();if(!r.ok||data.success===false)throw new Error(data.error||'Please sign in.');return data;};
 const dataCache=new Map();let scope='',settings={};
 async function wordList(level,difficulty){const k=level+'|'+difficulty;if(!dataCache.has(k))dataCache.set(k,api('word-list?level='+encodeURIComponent(level)+'&difficulty='+difficulty).then(d=>d.words).catch(e=>{dataCache.delete(k);throw e;}));return dataCache.get(k);}
 window.fetch=async(input,init={})=>{
   const url=new URL(typeof input==='string'?input:input.url,location.href);
   if(standaloneStudy&&url.origin===new URL(BeeClient.apiBase).origin&&url.pathname.startsWith('/api/live/'))throw new Error('Study is a standalone practice view.');
   if(url.origin===location.origin){
     const match=url.pathname.match(/\/(wordlists|word-data)\/([^/]+)\/([^/.]+)\.(txt|json)$/);
     if(match){try{const words=await wordList(decodeURIComponent(match[2]),match[3]);const data=match[1]==='wordlists'?words.map(w=>w.word).join('\n'):JSON.stringify(Object.fromEntries(words.map(w=>[w.word,{definition:w.definition,example:w.example,ipa:w.ipa,audio:w.audio}])));return new Response(data,{headers:{'Content-Type':match[4]==='txt'?'text/plain':'application/json'}});}catch(e){return new Response(JSON.stringify({error:e.message}),{status:503});}}
   }
   if(url.origin===new URL(BeeClient.apiBase).origin&&url.pathname.startsWith('/api/')){const headers=new Headers(init.headers||{});if(token)headers.set('X-Requested-With',token);init={...init,credentials:'omit',headers};}
   return nativeFetch(input,init);
 };
 const storage={getItem:k=>localStorage.getItem(scope+k),setItem:(k,v)=>localStorage.setItem(scope+k,v),removeItem:k=>localStorage.removeItem(scope+k)};
 const Channel=typeof BroadcastChannel==='function'?class extends BroadcastChannel{constructor(name){super(scope+name);}}:class{postMessage(){}addEventListener(){}removeEventListener(){}close(){}};
 const escape=value=>String(value||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function standby(){return `<div class="centered-layout standby-layout"><div class="standby-rotation"><div class="standby-set standby-school" data-standby="school">${settings.logo?`<img class="standby-logo" src="${escape(settings.logo)}" alt="School logo">`:''}<h1 class="headline">${escape(settings.schoolName)}</h1>${settings.tagline?`<p>${escape(settings.tagline)}</p>`:''}</div><div class="standby-set standby-partners" data-standby="partners">${(settings.partners||[]).map(src=>`<img class="standby-partner-logo" src="${escape(src)}" alt="Partner logo">`).join('')}</div></div></div>`;}
 function brand(){
   const r=document.documentElement;BeeAppearance.apply(settings);
   r.style.setProperty('--product-font',{modern:'system-ui, sans-serif',classic:'Georgia, serif',rounded:'system-ui, sans-serif'}[settings.font]);
   const icon=document.querySelector('link[rel=icon]');if(icon){if(settings.logo)icon.href=settings.logo;else icon.removeAttribute('href');}
   if(settings.motion==='reduced')r.dataset.motion='reduced';
   document.querySelectorAll('img').forEach(img=>{if(img.id==='camera-still'||img.closest('.standby-partners'))return;const secondary=img.closest('.english-brand')||img.classList.contains('english-brand');const src=secondary?settings.secondaryLogo:settings.logo;img.hidden=!src;if(src)img.src=src;else img.removeAttribute('src');});
   document.querySelectorAll('.school-brand strong,[data-product-school]').forEach(el=>el.textContent=settings.schoolName);
   document.querySelectorAll('.event-bug>span').forEach(el=>el.textContent=settings.eventName);
   document.querySelectorAll('.control-brand').forEach(el=>{const img=el.querySelector('img');img.hidden=!settings.logo;if(settings.logo)img.src=settings.logo;if(!el.querySelector('.product-brand-name')){const name=document.createElement('span');name.className='product-brand-name';name.textContent=settings.schoolName;el.append(name);}});
   if(!document.getElementById('product-back')&&!location.pathname.endsWith('screen.html')){const a=document.createElement('a');a.id='product-back';a.href=BeeClient.frontendBase+'?v='+BeeClient.release;a.textContent='← Dashboard';document.body.append(a);}
 }
 async function speak(word,level,difficulty){
   if(!standaloneStudy||!word)return;
   if(!window.speechSynthesis)throw new Error('Device speech is unavailable in this browser.');
   speechSynthesis.cancel();const speech=new SpeechSynthesisUtterance(word);speech.lang='en-US';speech.rate=.85;const voices=speechSynthesis.getVoices();speech.voice=voices.find(v=>v.lang==='en-US')||voices.find(v=>v.lang.startsWith('en'))||null;const volume=Number(document.getElementById('volume-slider')?.value??100)/100;speech.volume=Math.max(0,Math.min(1,volume));speechSynthesis.speak(speech);
 }
 async function start(scripts){
   try{
    if(!isAdmin&&!privatePreview&&!await guestAccess())return;
    const ctx=await api('context');settings=ctx.settings;scope='spelling-bee-app:'+ctx.account.id+':';window.BeeProduct.settings=settings;
    if(location.pathname.endsWith('/arena/admin.html')){const registered=(await api('school-session')).schoolSession;if(!registered?.ready)throw new Error('Create your school session in the workspace before opening Admin.');params.set('session',registered.code);history.replaceState(null,'',location.pathname+'?'+params.toString());}
    BeeAppearance.apply(settings);document.title=settings.schoolName+' · '+document.title;document.querySelectorAll('.arena').forEach(el=>el.remove());
    document.querySelectorAll('#pool-select,#admin-category').forEach(select=>{select.replaceChildren(...settings.categories.map(id=>new Option(settings.categoryNames?.[id]||id,id)));});
    if(ctx.role==='screen'&&!location.pathname.endsWith('screen.html'))throw new Error('Open the screen link provided by your school.');
    if(ctx.role==='judge'&&!location.pathname.endsWith('judge.html'))throw new Error('Open the judge link provided by your school.');
    if(!standaloneStudy&&ctx.code&&!params.get('session')){params.set('session',ctx.code);history.replaceState(null,'',location.pathname+'?'+params.toString());}
    for(const script of scripts){const el=document.createElement('script');if(script.src){el.src=script.src;await new Promise((resolve,reject)=>{el.onload=resolve;el.onerror=()=>reject(new Error('The competition could not load. Please refresh.'));document.body.append(el);});}else{el.textContent=script.code;document.body.append(el);}}
    brand();
   }catch(e){document.body.replaceChildren();const main=document.createElement('main');main.className='product-access-error';const h=document.createElement('h1');h.textContent='Spelling Bee App';const p=document.createElement('p');p.textContent=e.message;const a=document.createElement('a');a.href=BeeClient.frontendBase+'?v='+BeeClient.release;a.textContent=isAdmin?'Go to sign in':'Try another session code';if(!isAdmin){a.href=location.pathname+'?v='+BeeClient.release;a.onclick=()=>sessionStorage.removeItem('bee-school-code');}main.append(h,p,a);document.body.append(main);}
 }
 const categoryLabel=id=>settings.categoryNames?.[id]||id;
 return {start,storage,Channel,settings,standby,speak,categoryLabel};
})();
