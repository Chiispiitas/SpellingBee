const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let context,settings,words=[],dirtyWords=false,dirtyBrand=false,currentPage='overview',wordLoading=false;
let loadedLevel='4TH-5TH',loadedDifficulty='easy';
const levels=['4TH-5TH','6TH-7TH','JUNIOR','SENIOR'],difficulties=['easy','medium','hard','tiebreaker'];
const api=(path,body)=>window.BeeClient.request(path,body);
function notice(message,error=false){$('notice').textContent=message;$('notice').classList.toggle('error',error);$('notice').hidden=false;}
async function busy(button,action,label='Saving…'){
 const original=button.textContent;button.disabled=true;button.textContent=label;
 try{return await action();}catch(e){notice(e.message,true);throw e;}finally{button.disabled=false;button.textContent=original;}
}
function run(button,action,label){return busy(button,action,label).catch(()=>{});}
function openPage(page){
 currentPage=page;document.querySelectorAll('[data-page]').forEach(el=>el.hidden=el.dataset.page!==page);
 document.querySelectorAll('[data-nav]').forEach(el=>el.classList.toggle('active',el.dataset.nav===page));
 $('breadcrumb').textContent='Workspace / '+({overview:'Overview',branding:'Appearance',words:'Word lists',access:'Account & backups',owner:'Customer accounts'}[page]);
 $('notice').hidden=true;if(page==='words'&&!words.length&&!dirtyWords)loadWords();if(page==='owner')loadAccounts();
 window.scrollTo(0,0);
}
function preview(){
 const form=new FormData($('brand-form'));for(const [key,value] of form)settings[key]=value;
 const palettes={midnight:'#101b2c',slate:'#26384b',ivory:'#f3eee4',forest:'#123a31',plum:'#34233f'};
 const light=settings.theme==='ivory';const font={modern:'Manrope, sans-serif',classic:'Georgia, serif',rounded:'ui-rounded, system-ui'}[settings.font];
 for(const id of ['overview-preview','brand-preview']){
  const box=$(id);box.style.background=`radial-gradient(ellipse at 50% 0%, ${settings.accent}25, transparent 65%),${settings.background||palettes[settings.theme]}`;
  box.style.color=light?'#223243':'#f4f7fb';box.style.fontFamily=font;
 }
 $('preview-logo').src=settings.logo||'brand.svg';$('preview-school').textContent=settings.schoolName;$('preview-event').textContent=settings.eventName;$('preview-tagline').textContent=settings.tagline;
 document.querySelector('[data-school-logo]').src=settings.logo||'brand.svg';document.querySelector('[data-school-name]').textContent=settings.schoolName;document.querySelector('[data-event-name]').textContent=settings.eventName;document.querySelector('[data-tagline]').textContent=settings.tagline;
 $('partner-thumbnails').innerHTML=(settings.partners||[]).map(src=>`<img src="${esc(src)}" class="partner-thumb" alt="Partner logo"/>`).join('');
}
function fillBrand(){
 for(const el of $('brand-form').elements)if(el.name&&settings[el.name]!=null)el.value=settings[el.name];preview();
}
async function showStudio(){
 context=await api('context');if(!['owner','customer'].includes(context.role))throw new Error('Please sign in with your school account.');
 settings=context.settings;$('login-view').hidden=true;$('studio-view').hidden=false;
 $('sidebar-school').textContent=settings.schoolName;$('sidebar-user').textContent=context.account.username;$('overview-school').textContent=settings.schoolName;
 $('owner-nav').hidden=context.role!=='owner';fillBrand();
 const saved=sessionStorage.getItem('bee-studio-code:'+context.account.id);if(saved)$('launch-code').value=saved;updateAdminLink();
}
$('login-form').addEventListener('submit',event=>{
 event.preventDefault();$('login-status').textContent='';const button=event.submitter;
 button.disabled=true;button.textContent='Signing in…';
 const form=Object.fromEntries(new FormData(event.target));api('login',form).then(data=>{BeeClient.setToken(data.token);return showStudio();}).catch(e=>$('login-status').textContent=e.message).finally(()=>{button.disabled=false;button.innerHTML='Sign in <span aria-hidden="true"></span>';});
});
$('show-password').onclick=()=>{const input=$('login-form').elements.password;input.type=input.type==='password'?'text':'password';$('show-password').textContent=input.type==='password'?'Show':'Hide';};
$('logout').onclick=()=>{if((dirtyWords||dirtyBrand)&&!confirm('You have unsaved changes. Sign out anyway?'))return;api('logout',{}).then(()=>{BeeClient.clearToken();location.reload();}).catch(e=>notice(e.message,true));};
document.querySelectorAll('[data-nav],[data-go]').forEach(el=>el.onclick=()=>openPage(el.dataset.nav||el.dataset.go));
function updateAdminLink(){const code=$('launch-code').value.replace(/\D/g,'').slice(0,16);$('launch-code').value=code;$('open-admin').href='arena/admin.html?session='+code;if(context)sessionStorage.setItem('bee-studio-code:'+context.account.id,code);}
$('launch-code').oninput=updateAdminLink;
$('make-links').onclick=()=>run($('make-links'),async()=>{
 const {links}=await api('links',{code:$('launch-code').value});$('judge-link').value=links.judge;$('screen-link').value=links.screen+'&view=stage';$('launch-stage').href=links.screen+'&view=stage';$('launch-camera').href=links.screen+'&view=camera';$('share-links').hidden=false;notice('Access links are ready. Start the same session from competition Admin.');
},'Creating links…');
document.querySelectorAll('[data-copy]').forEach(el=>el.onclick=()=>run(el,async()=>{await navigator.clipboard.writeText($(el.dataset.copy).value);notice('Link copied.');},'Copying…'));
$('brand-form').addEventListener('submit',e=>e.preventDefault());
$('brand-form').addEventListener('input',()=>{dirtyBrand=true;preview();});
$('brand-form').elements.theme.addEventListener('change',()=>{const f=$('brand-form').elements;f.background.value={midnight:'#101b2c',slate:'#26384b',ivory:'#f3eee4',forest:'#123a31',plum:'#34233f'}[f.theme.value];preview();});
async function imageData(file){
 if(!file||!['image/png','image/jpeg','image/webp'].includes(file.type))throw new Error('Choose a PNG, JPG or WebP image.');
 if(file.size>5*1024*1024)throw new Error('Choose a logo under 5 MB.');
 const bitmap=await createImageBitmap(file);const scale=Math.min(1,700/bitmap.width,350/bitmap.height);const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
 let result=canvas.toDataURL('image/webp',.9);if(result.length>145000)result=canvas.toDataURL('image/webp',.65);if(result.length>145000)throw new Error('This logo is too detailed. Choose a smaller image.');return result;
}
for(const [id,field] of [['school-logo','logo'],['secondary-logo','secondaryLogo']])$(id).onchange=async()=>{try{settings[field]=await imageData($(id).files[0]);dirtyBrand=true;preview();}catch(e){notice(e.message,true);}$(id).value='';};
$('partner-logos').onchange=async()=>{try{const files=[...$('partner-logos').files];if(files.length+(settings.partners||[]).length>4)throw new Error('You can add up to four partner logos.');settings.partners=[...(settings.partners||[]),...await Promise.all(files.map(imageData))];dirtyBrand=true;preview();}catch(e){notice(e.message,true);}$('partner-logos').value='';};
document.querySelectorAll('[data-clear]').forEach(el=>el.onclick=()=>{settings[el.dataset.clear]='';dirtyBrand=true;preview();});
$('clear-partners').onclick=()=>{settings.partners=[];dirtyBrand=true;preview();};
$('save-brand').onclick=()=>run($('save-brand'),async()=>{preview();settings=(await api('settings',settings)).settings;dirtyBrand=false;fillBrand();$('sidebar-school').textContent=settings.schoolName;$('overview-school').textContent=settings.schoolName;notice('Appearance saved. Refresh open competition windows to apply it.');});
async function loadWords(){
 if(wordLoading)return;wordLoading=true;$('word-count').textContent='Loading…';
 $('save-words').disabled=true;
 try{const level=$('word-category').value,difficulty=$('word-difficulty').value;const data=await api(`word-list?level=${encodeURIComponent(level)}&difficulty=${difficulty}`);words=data.words;loadedLevel=level;loadedDifficulty=difficulty;dirtyWords=false;renderWords();}catch(e){notice(e.message,true);$('word-count').textContent='Could not load';}finally{wordLoading=false;$('save-words').disabled=false;}
}
for(const id of ['word-category','word-difficulty'])$(id).onchange=()=>{if(dirtyWords&&!confirm('Discard unsaved changes to this list?')){$('word-category').value=loadedLevel;$('word-difficulty').value=loadedDifficulty;return;}loadWords();};
function renderWords(){
 const q=$('word-search').value.toLowerCase();$('word-count').textContent=words.length+' words'+(dirtyWords?' · unsaved':'');
 $('word-rows').innerHTML=words.map((w,i)=>({w,i})).filter(({w})=>!q||[w.word,w.definition,w.example].some(v=>String(v||'').toLowerCase().includes(q))).map(({w,i})=>`<tr data-row="${i}"><td><input data-field="word" aria-label="Word ${i+1}" value="${esc(w.word)}" maxlength="80"/></td><td><textarea rows="2" data-field="definition" aria-label="Definition for word ${i+1}" maxlength="600">${esc(w.definition)}</textarea></td><td><textarea rows="2" data-field="example" aria-label="Example for word ${i+1}" maxlength="600">${esc(w.example)}</textarea></td><td><input data-field="ipa" aria-label="Pronunciation for word ${i+1}" value="${esc(w.ipa)}" placeholder="Optional pronunciation" maxlength="120"/><input data-field="audio" aria-label="Audio link for word ${i+1}" value="${esc(w.audio)}" placeholder="Optional HTTPS audio link" type="url"/></td><td><button data-remove="${i}" aria-label="Remove word ${i+1}">×</button></td></tr>`).join('')||'<tr><td colspan="5"><p class="muted">No words here yet. Add a word or paste your list.</p></td></tr>';
}
$('word-rows').addEventListener('input',e=>{const field=e.target.dataset.field;if(!field)return;words[Number(e.target.closest('[data-row]').dataset.row)][field]=e.target.value;dirtyWords=true;$('word-count').textContent=words.length+' words · unsaved';});
$('word-rows').addEventListener('click',e=>{const b=e.target.closest('[data-remove]');if(!b)return;words.splice(Number(b.dataset.remove),1);dirtyWords=true;renderWords();});
$('word-search').oninput=renderWords;
function addWord(){words.push({word:'',definition:'',example:'',ipa:'',audio:''});dirtyWords=true;$('word-search').value='';renderWords();$('word-rows').lastElementChild?.querySelector('input')?.focus();}
$('add-word').onclick=addWord;$('add-word-bottom').onclick=addWord;
$('save-words').onclick=()=>run($('save-words'),async()=>{const data=await api('word-list',{level:loadedLevel,difficulty:loadedDifficulty,words});words=data.words;dirtyWords=false;renderWords();notice(`${data.count} words saved. Refresh an open Admin or Study view before using the updated list.`);});
function parseDelimited(text){
 text=text.replace(/^\uFEFF/,'');const first=text.split(/\r?\n/)[0]||'';const delimiter=first.includes('\t')?'\t':',';
 const rows=[];let row=[],value='',quoted=false;
 for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){value+='"';i++;}else if(quoted||value==='')quoted=!quoted;else value+=c;}else if(c===delimiter&&!quoted){row.push(value);value='';}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(value);if(row.some(s=>s.trim()))rows.push(row);row=[];value='';}else value+=c;}
 if(quoted)throw new Error('An opening quote is missing its closing quote.');row.push(value);if(row.some(s=>s.trim()))rows.push(row);
 if(rows[0]&&/^(word|palabra)$/i.test(rows[0][0].trim()))rows.shift();
 return rows.map(r=>({word:r[0]?.trim()||'',definition:r[1]?.trim()||'',example:r[2]?.trim()||'',ipa:r[3]?.trim()||'',audio:r[4]?.trim()||''}));
}
function importWords(text,replace){
 const rows=parseDelimited(text);if(!rows.length)throw new Error('Paste at least one word.');const next=replace?[]:[...words];const seen=new Set(next.map(w=>w.word.toLowerCase().trim()));let skipped=0;
 for(const row of rows){const normalized=row.word.toLowerCase().trim();if(!normalized||seen.has(normalized)){skipped++;continue;}seen.add(normalized);next.push(row);}
 if(next.length>2000)throw new Error('A list can contain up to 2,000 words.');words=next;dirtyWords=true;renderWords();notice(`Words added to the editor${skipped?`; ${skipped} duplicate or empty rows skipped`:''}. Review and save your list.`);
}
$('open-import').onclick=()=>{$('import-status').textContent='';$('import-dialog').showModal();};
$('apply-import').onclick=()=>{try{importWords($('import-text').value,$('import-mode').value==='replace');$('import-dialog').close();$('import-text').value='';}catch(e){$('import-status').textContent=e.message;}};
$('csv-file').onchange=async()=>{try{const file=$('csv-file').files[0];if(!file)return;if(file.size>400000)throw new Error('Import a file under 400 KB.');$('import-text').value=await file.text();$('import-dialog').showModal();}catch(e){notice(e.message,true);}$('csv-file').value='';};
function download(name,content,type){const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),3000);}
const csvValue=s=>{let v=String(s??'');if(/^[=+@\-\t\r]/.test(v))v="'"+v;return '"'+v.replace(/"/g,'""')+'"';};
const csv=rows=>[['word','definition','example','pronunciation','audio'],...rows.map(w=>[w.word,w.definition,w.example,w.ipa,w.audio])].map(r=>r.map(csvValue).join(',')).join('\r\n');
$('export-csv').onclick=()=>download(`${loadedLevel}-${loadedDifficulty}.csv`,csv(words),'text/csv;charset=utf-8');
$('csv-template').onclick=()=>download('spelling-bee-template.csv',csv([{word:'apple',definition:'A round fruit.',example:'I eat an apple.',ipa:'',audio:''}]),'text/csv;charset=utf-8');
$('password-form').onsubmit=e=>{e.preventDefault();run(e.submitter,async()=>{await api('password',Object.fromEntries(new FormData(e.target)));dirtyBrand=dirtyWords=false;BeeClient.clearToken();location.reload();});};
$('backup').onclick=()=>run($('backup'),async()=>{const lists=[];for(const level of levels)for(const difficulty of difficulties){const data=await api(`word-list?level=${encodeURIComponent(level)}&difficulty=${difficulty}`);lists.push({level,difficulty,words:data.words});}const saved=await api('settings');download('spelling-bee-backup.json',JSON.stringify({product:'Spelling Bee App',version:1,exportedAt:new Date().toISOString(),settings:saved.settings,lists},null,2),'application/json');notice('Backup downloaded.');},'Preparing backup…');
$('restore').onchange=async()=>{
 try{const file=$('restore').files[0];if(!file)return;if(file.size>6500000)throw new Error('That backup is too large.');const backup=JSON.parse(await file.text());if(backup.product!=='Spelling Bee App'||backup.version!==1||!Array.isArray(backup.lists))throw new Error('Choose a Spelling Bee App backup.');if(!confirm('Replace your saved appearance and word lists with this backup?'))return;
 $('restore').disabled=true;for(const list of backup.lists){await api('word-list',list);await new Promise(r=>setTimeout(r,1200));}settings=(await api('settings',backup.settings)).settings;fillBrand();dirtyBrand=false;dirtyWords=false;words=[];notice('Backup restored. Refresh open competition views.');
 }catch(e){notice('Restore stopped: '+e.message+'. Lists already confirmed remain saved.',true);}finally{$('restore').value='';$('restore').disabled=false;}
};
async function loadAccounts(){try{const {accounts}=await api('accounts');$('account-rows').innerHTML=accounts.filter(a=>a.role!=='owner').map(a=>`<article class="account-row"><strong>${esc(a.schoolName)}</strong><small>${esc(a.username)} · ${a.enabled?'Active':'Disabled'}</small><div class="inline-actions"><button class="text-button" data-reset="${esc(a.username)}" data-school="${esc(a.schoolName)}">Reset password</button><button class="text-button" data-access="${a.enabled?'disable':'enable'}" data-user="${esc(a.username)}">${a.enabled?'Disable':'Enable'} access</button></div></article>`).join('')||'<p class="muted">No customer accounts yet.</p>';}catch(e){notice(e.message,true);}}
$('account-form').onsubmit=e=>{e.preventDefault();run(e.submitter,async()=>{const form=Object.fromEntries(new FormData(e.target));await api('accounts',form);notice(`Account created for ${form.schoolName}. Share their username and password privately.`);e.target.reset();await loadAccounts();},'Creating workspace…');};
$('account-rows').onclick=e=>{const reset=e.target.closest('[data-reset]'),access=e.target.closest('[data-access]');if(reset){const password=prompt('Choose a new password for '+reset.dataset.reset+' (at least 6 characters):');if(!password)return;run(reset,async()=>{await api('accounts',{action:'reset',username:reset.dataset.reset,schoolName:reset.dataset.school,password});notice('Password reset. Previously shared links have been invalidated.');});}if(access){if(!confirm(`${access.dataset.access==='disable'?'Disable':'Enable'} access for ${access.dataset.user}?`))return;run(access,async()=>{await api('accounts',{action:access.dataset.access,username:access.dataset.user});await loadAccounts();notice('Account access updated.');});}};
window.addEventListener('beforeunload',e=>{if(dirtyWords||dirtyBrand){e.preventDefault();e.returnValue='';}});
showStudio().catch(e=>{if(e.status!==401)$('login-status').textContent=e.message;});
