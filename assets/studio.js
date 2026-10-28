const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let context,settings,words=[],dirtyWords=false,dirtyBrand=false,currentPage='overview',wordLoading=false;
let categorySavePromise=Promise.resolve();
let loadedLevel='4TH-5TH',loadedDifficulty='easy';
let levels=[];let categoryDraft=[];
const difficulties=['easy','medium','hard','tiebreaker'];
const api=(path,body)=>window.BeeClient.request(path,body);

const appearanceAutosave=BeeAutosave.create({
 read:()=>{preview();if(!$('brand-form').checkValidity()||!settings.schoolName.trim()||!settings.eventName.trim())throw new Error('Complete the required school and event fields.');return structuredClone(settings);},
 write:async payload=>{await categorySavePromise.catch(()=>{});return api('settings',{...payload,categories:settings.categories,categoryNames:settings.categoryNames});},
 onSaved:(data,{current})=>{if(current){settings=data.settings;dirtyBrand=false;preview();$('sidebar-school').textContent=settings.schoolName;$('overview-school').textContent=settings.schoolName;}},
 onStatus:(state,error)=>{const el=$('appearance-save-status');el.dataset.state=state;el.textContent=state==='saved'?'Saved':state==='error'?'Not saved. Retrying… '+error.message:'Saving…';}
});
function changeAppearance(){dirtyBrand=true;preview();appearanceAutosave.mark();}

function notice(message,error=false){$('notice').textContent=message;$('notice').classList.toggle('error',error);$('notice').hidden=false;}
async function busy(button,action,label='Saving…'){
 const original=button.textContent;button.disabled=true;button.textContent=label;
 try{return await action();}catch(e){notice(e.message,true);throw e;}finally{button.disabled=false;button.textContent=original;}
}
function run(button,action,label){return busy(button,action,label).catch(()=>{});}
function openPage(page){
 if(dirtyBrand)appearanceAutosave.flush().catch(e=>notice(e.message,true));
 currentPage=page;document.querySelectorAll('[data-page]').forEach(el=>el.hidden=el.dataset.page!==page);
 document.querySelectorAll('[data-nav]').forEach(el=>el.classList.toggle('active',el.dataset.nav===page));
 $('breadcrumb').textContent='Workspace / '+({overview:'Overview',branding:'Appearance',words:'Word lists',access:'Account & backups',owner:'Customer accounts'}[page]);
 $('notice').hidden=true;if(page==='words'&&!words.length&&!dirtyWords)loadWords();if(page==='owner')loadAccounts();
 window.scrollTo(0,0);
}
function preview(){
 const form=new FormData($('brand-form'));for(const [key,value] of form)settings[key]=value;
 const colors=BeeAppearance.colors(settings);BeeAppearance.applyWorkspace(settings);
 const palettes=BeeAppearance.palettes;
 const light=colors.base==='#17212b';const font={modern:'Manrope, sans-serif',classic:'Georgia, serif',rounded:'ui-rounded, system-ui'}[settings.font];
 for(const id of ['overview-preview','brand-preview']){
  const box=$(id);box.style.background=settings.background;
  box.style.color=colors.base;box.style.fontFamily=font;
 }
 $('preview-logo').src=settings.logo||'';$('preview-school').textContent=settings.schoolName;$('preview-event').textContent=settings.eventName;$('preview-tagline').textContent=settings.tagline;
 document.querySelector('[data-school-logo]').src=settings.logo||'';document.querySelector('[data-school-name]').textContent=settings.schoolName;document.querySelector('[data-event-name]').textContent=settings.eventName;document.querySelector('[data-tagline]').textContent=settings.tagline;
 $('preview-logo').hidden=!settings.logo;document.querySelector('[data-school-logo]').hidden=!settings.logo;
 const identity=document.querySelector('.school-identity');identity.querySelector('span').textContent=settings.schoolName;const logo=identity.querySelector('img');logo.hidden=!settings.logo;if(settings.logo)logo.src=settings.logo;else logo.removeAttribute('src');
 document.title=settings.schoolName+' · Spelling Bee';document.querySelector('.workspace-footer').firstChild.textContent=settings.schoolName+' ';const icon=document.querySelector('link[rel=icon]');if(settings.logo)icon.href=settings.logo;else icon.removeAttribute('href');
 $('partner-thumbnails').innerHTML=(settings.partners||[]).map(src=>`<img src="${esc(src)}" class="partner-thumb" alt="Partner logo"/>`).join('');
}
function fillBrand(){
 for(const el of $('brand-form').elements)if(el.name&&settings[el.name]!=null&&el.value!==String(settings[el.name]))el.value=settings[el.name];preview();
}
async function showStudio(){
 context=await api('context');if(!['owner','customer'].includes(context.role))throw new Error('Please sign in with your school account.');
 settings=context.settings;$('login-view').hidden=true;$('studio-view').hidden=false;
 $('sidebar-school').textContent=settings.schoolName;$('sidebar-user').textContent=context.account.username;$('overview-school').textContent=settings.schoolName;
 $('owner-nav').hidden=context.role!=='owner';fillBrand();fillCategories();
 const saved=sessionStorage.getItem('bee-studio-code:'+context.account.id);if(saved)$('launch-code').value=saved;updateAdminLink();
}
$('login-form').addEventListener('submit',event=>{
 event.preventDefault();$('login-status').textContent='';const button=event.submitter;
 button.disabled=true;button.textContent='Signing in…';
 const form=Object.fromEntries(new FormData(event.target));api('login',form).then(data=>{BeeClient.setToken(data.token);return showStudio();}).catch(e=>$('login-status').textContent=e.message).finally(()=>{button.disabled=false;button.innerHTML='Sign in <span aria-hidden="true"></span>';});
});
$('show-password').onclick=()=>{const input=$('login-form').elements.password;input.type=input.type==='password'?'text':'password';$('show-password').textContent=input.type==='password'?'Show':'Hide';};
$('logout').onclick=async()=>{if(dirtyWords&&!confirm('You have unsaved word-list changes. Sign out anyway?'))return;try{await appearanceAutosave.flush();await api('logout',{});BeeClient.clearToken();location.reload();}catch(e){notice(e.message,true);}};
document.querySelectorAll('[data-nav],[data-go]').forEach(el=>el.onclick=()=>openPage(el.dataset.nav||el.dataset.go));
function updateAdminLink(){const code=$('launch-code').value.replace(/\D/g,'').slice(0,16);$('launch-code').value=code;$('open-admin').href='arena/admin.html?session='+code+'&v='+BeeClient.release;if(context)sessionStorage.setItem('bee-studio-code:'+context.account.id,code);}
$('launch-code').oninput=updateAdminLink;
$('make-links').onclick=()=>run($('make-links'),async()=>{
 const {links}=await api('links',{code:$('launch-code').value});$('judge-link').value=links.judge;$('screen-link').value=links.screen+'&view=stage';$('launch-stage').href=links.screen+'&view=stage';$('launch-camera').href=links.screen+'&view=camera';$('share-links').hidden=false;notice('Access links are ready. Start the same session from competition Admin.');
},'Creating links…');
document.querySelectorAll('[data-copy]').forEach(el=>el.onclick=()=>run(el,async()=>{await navigator.clipboard.writeText($(el.dataset.copy).value);notice('Link copied.');},'Copying…'));
$('brand-form').addEventListener('submit',e=>e.preventDefault());
$('brand-form').addEventListener('input',event=>{if(event.target.type!=='file')changeAppearance();});
$('brand-form').elements.theme.addEventListener('change',()=>{const f=$('brand-form').elements;const p=BeeAppearance.palettes[f.theme.value];f.background.value=p.background;f.accent.value=p.accent;f.windowColor.value=p.windowColor;changeAppearance();});
async function imageData(file){
 if(!file||!['image/png','image/jpeg','image/webp'].includes(file.type))throw new Error('Choose a PNG, JPG or WebP image.');
 if(file.size>5*1024*1024)throw new Error('Choose a logo under 5 MB.');
 const bitmap=await createImageBitmap(file);const scale=Math.min(1,700/bitmap.width,350/bitmap.height);const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
 let result=canvas.toDataURL('image/webp',.9);if(result.length>145000)result=canvas.toDataURL('image/webp',.65);if(result.length>145000)throw new Error('This logo is too detailed. Choose a smaller image.');return result;
}
for(const [id,field] of [['school-logo','logo'],['secondary-logo','secondaryLogo']])$(id).onchange=async()=>{try{settings[field]=await imageData($(id).files[0]);changeAppearance();}catch(e){notice(e.message,true);}$(id).value='';};
$('partner-logos').onchange=async()=>{try{const files=[...$('partner-logos').files];if(files.length+(settings.partners||[]).length>4)throw new Error('You can add up to four partner logos.');settings.partners=[...(settings.partners||[]),...await Promise.all(files.map(imageData))];changeAppearance();}catch(e){notice(e.message,true);}$('partner-logos').value='';};
document.querySelectorAll('[data-clear]').forEach(el=>el.onclick=()=>{settings[el.dataset.clear]='';changeAppearance();});
$('clear-partners').onclick=()=>{settings.partners=[];changeAppearance();};

async function loadWords(){
 if(wordLoading)return;wordLoading=true;$('word-count').textContent='Loading…';
 $('save-words').disabled=true;
 try{const level=$('word-category').value,difficulty=$('word-difficulty').value;const data=await api(`word-list?level=${encodeURIComponent(level)}&difficulty=${difficulty}`);words=data.words;loadedLevel=level;loadedDifficulty=difficulty;dirtyWords=false;renderWords();}catch(e){notice(e.message,true);$('word-count').textContent='Could not load';}finally{wordLoading=false;$('save-words').disabled=false;}
}
for(const id of ['word-category','word-difficulty'])$(id).onchange=()=>{if(dirtyWords&&!confirm('Discard unsaved changes to this list?')){$('word-category').value=loadedLevel;$('word-difficulty').value=loadedDifficulty;return;}loadWords();};
function renderWords(){
 const q=$('word-search').value.toLowerCase();$('word-count').textContent=words.length+' words'+(dirtyWords?' · unsaved':'');
 $('word-rows').innerHTML=words.map((w,i)=>({w,i})).filter(({w})=>!q||[w.word,w.definition,w.example].some(v=>String(v||'').toLowerCase().includes(q))).map(({w,i})=>`<tr data-row="${i}"><td><input data-field="word" aria-label="Word ${i+1}" value="${esc(w.word)}" maxlength="80"/></td><td><textarea rows="2" data-field="definition" aria-label="Definition for word ${i+1}" maxlength="600">${esc(w.definition)}</textarea></td><td><textarea rows="2" data-field="example" aria-label="Example for word ${i+1}" maxlength="600">${esc(w.example)}</textarea></td><td><input data-field="ipa" aria-label="Pronunciation for word ${i+1}" value="${esc(w.ipa)}" placeholder="American IPA, e.g. [əˈkʰɹu]" maxlength="120"/></td><td><button data-remove="${i}" aria-label="Remove word ${i+1}">×</button></td></tr>`).join('')||'<tr><td colspan="5"><p class="muted">No words here yet. Add a word or paste your list.</p></td></tr>';
}
$('word-rows').addEventListener('input',e=>{const field=e.target.dataset.field;if(!field)return;words[Number(e.target.closest('[data-row]').dataset.row)][field]=e.target.value;dirtyWords=true;$('word-count').textContent=words.length+' words · unsaved';});
$('word-rows').addEventListener('click',e=>{const b=e.target.closest('[data-remove]');if(!b)return;words.splice(Number(b.dataset.remove),1);dirtyWords=true;renderWords();});
$('word-search').oninput=renderWords;
function addWord(){words.push({word:'',definition:'',example:'',ipa:'',audio:''});dirtyWords=true;$('word-search').value='';renderWords();$('word-rows').lastElementChild?.querySelector('input')?.focus();}
$('add-word').onclick=addWord;$('add-word-bottom').onclick=addWord;
$('save-words').onclick=()=>run($('save-words'),async()=>{const data=await api('word-list',{level:loadedLevel,difficulty:loadedDifficulty,words});words=data.words;dirtyWords=false;renderWords();notice(`${data.count} words saved. Refresh an open Admin or Study view before using the updated list.`);});
function parseDelimited(text){
 text=text.trim().replace(/^```(?:csv|text)?\s*\n/i,'').replace(/\n```$/,'').replace(/^\uFEFF/,'');const first=text.split(/\r?\n/)[0]||'';const delimiter=first.includes('\t')?'\t':',';
 const rows=[];let row=[],value='',quoted=false;
 for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){value+='"';i++;}else if(quoted||value==='')quoted=!quoted;else value+=c;}else if(c===delimiter&&!quoted){row.push(value);value='';}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(value);if(row.some(s=>s.trim()))rows.push(row);row=[];value='';}else value+=c;}
 if(quoted)throw new Error('An opening quote is missing its closing quote.');row.push(value);if(row.some(s=>s.trim()))rows.push(row);
 if(rows[0]?.length>1&&/^(word|palabra)$/i.test(rows[0][0].trim())&&/^(definition|definici[oó]n)$/i.test(rows[0][1].trim()))rows.shift();
 if(rows.some(r=>r.length>5))throw new Error('A row has more than five fields. Put text containing commas inside double quotes.');
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
$('backup').onclick=()=>run($('backup'),async()=>{await appearanceAutosave.flush();const lists=[];for(const level of settings.categories)for(const difficulty of difficulties){const data=await api(`word-list?level=${encodeURIComponent(level)}&difficulty=${difficulty}`);lists.push({level,difficulty,words:data.words});}const saved=await api('settings');download('spelling-bee-backup.json',JSON.stringify({product:'Spelling Bee App',version:1,exportedAt:new Date().toISOString(),settings:saved.settings,lists},null,2),'application/json');notice('Backup downloaded.');},'Preparing backup…');
$('restore').onchange=async()=>{
 try{const file=$('restore').files[0];if(!file)return;if(file.size>6500000)throw new Error('That backup is too large.');const backup=JSON.parse(await file.text());if(backup.product!=='Spelling Bee App'||backup.version!==1||!Array.isArray(backup.lists))throw new Error('Choose a Spelling Bee App backup.');if(!confirm('Replace your saved appearance and word lists with this backup?'))return;
 $('restore').disabled=true;await appearanceAutosave.flush();settings=(await api('settings',backup.settings)).settings;fillCategories();for(const list of backup.lists){await api('word-list',list);await new Promise(r=>setTimeout(r,1200));}fillBrand();dirtyBrand=false;dirtyWords=false;words=[];notice('Backup restored. Refresh open competition views.');
 }catch(e){notice('Restore stopped: '+e.message+'. Lists already confirmed remain saved.',true);}finally{$('restore').value='';$('restore').disabled=false;}
};
async function loadAccounts(){try{const {accounts}=await api('accounts');$('account-rows').innerHTML=accounts.filter(a=>a.role!=='owner').map(a=>`<article class="account-row"><strong>${esc(a.schoolName)}</strong><small>${esc(a.username)} · ${a.enabled?'Active':'Disabled'}</small><div class="inline-actions"><button class="text-button" data-reset="${esc(a.username)}" data-school="${esc(a.schoolName)}">Reset password</button><button class="text-button" data-access="${a.enabled?'disable':'enable'}" data-user="${esc(a.username)}">${a.enabled?'Disable':'Enable'} access</button></div></article>`).join('')||'<p class="muted">No customer accounts yet.</p>';}catch(e){notice(e.message,true);}}
$('account-form').onsubmit=e=>{e.preventDefault();run(e.submitter,async()=>{const form=Object.fromEntries(new FormData(e.target));await api('accounts',form);notice(`Account created for ${form.schoolName}. Share their username and password privately.`);e.target.reset();await loadAccounts();},'Creating workspace…');};
$('account-rows').onclick=e=>{const reset=e.target.closest('[data-reset]'),access=e.target.closest('[data-access]');if(reset){const password=prompt('Choose a new password for '+reset.dataset.reset+' (at least 6 characters):');if(!password)return;run(reset,async()=>{await api('accounts',{action:'reset',username:reset.dataset.reset,schoolName:reset.dataset.school,password});notice('Password reset. Previously shared links have been invalidated.');});}if(access){if(!confirm(`${access.dataset.access==='disable'?'Disable':'Enable'} access for ${access.dataset.user}?`))return;run(access,async()=>{await api('accounts',{action:access.dataset.access,username:access.dataset.user});await loadAccounts();notice('Account access updated.');});}};
window.addEventListener('beforeunload',e=>{if(dirtyWords||dirtyBrand){e.preventDefault();e.returnValue='';}});


function fillCategories(){
 levels=[...settings.categories];categoryDraft=levels.map(id=>({id,name:settings.categoryNames?.[id]||id}));
 const selected=$('word-category').value;$('word-category').replaceChildren(...categoryDraft.map(c=>new Option(c.name,c.id)));if(levels.includes(selected))$('word-category').value=selected;
 renderCategories();
}
function renderCategories(){
 $('category-rows').innerHTML=categoryDraft.map((c,i)=>`<div class="category-row"><input data-category="${i}" aria-label="Category ${i+1} name" maxlength="40" value="${esc(c.name)}"/><button data-category-remove="${i}" class="secondary" ${categoryDraft.length===1?'disabled':''}>Remove</button></div>`).join('');$('add-category').disabled=categoryDraft.length>=4;
}
$('category-rows').oninput=e=>{if(e.target.dataset.category!==undefined)categoryDraft[Number(e.target.dataset.category)].name=e.target.value;};
$('category-rows').onclick=e=>{const b=e.target.closest('[data-category-remove]');if(!b)return;categoryDraft.splice(Number(b.dataset.categoryRemove),1);renderCategories();};
$('add-category').onclick=()=>{if(categoryDraft.length>=4)return;categoryDraft.push({id:'cat-'+crypto.randomUUID().slice(0,12),name:''});renderCategories();$('category-rows').lastElementChild.querySelector('input').focus();};
$('save-categories').onclick=()=>run($('save-categories'),async()=>{
 if(dirtyWords)throw new Error('Save or discard your word-list edits before changing categories.');
 if(categoryDraft.some(c=>!c.name.trim()))throw new Error('Enter a name for every category.');
 const savedAppearance=dirtyBrand;await appearanceAutosave.flush();
 categorySavePromise=(async()=>{const latest=(await api('settings')).settings;const saved=(await api('settings',{...latest,categories:categoryDraft.map(c=>c.id),categoryNames:Object.fromEntries(categoryDraft.map(c=>[c.id,c.name.trim()]))})).settings;settings=dirtyBrand?{...saved,...settings,categories:saved.categories,categoryNames:saved.categoryNames}:saved;return saved;})();
 await categorySavePromise;fillBrand();$('sidebar-school').textContent=settings.schoolName;$('overview-school').textContent=settings.schoolName;
 fillCategories();words=[];await loadWords();notice((savedAppearance?'Categories and appearance saved.':'Categories saved.')+' Refresh open competition views to load your changes.');
});
const formattingPrompt=`Convert my word list into CSV for a spelling bee app.
Return only CSV, one row per word, with this five-column header:
word,definition,example,pronunciation,audio
Provide an accurate American English IPA pronunciation for EVERY word. Use detailed General American phonetic transcription in square brackets, in this style: abject [ˈæb.dʒɛkt̚], accrue [əˈkʰɹu]. Mark primary/secondary stress and syllable divisions, American rhotic sounds (ɹ, ɚ, ɝ), aspiration, flapping and unreleased stops where appropriate. Use narrow phonetic detail, not British pronunciation or a simplified respelling. Do not insert features where they are not pronounced.
Write short definitions and examples using English vocabulary at or below B1. Do not include the target word in its definition. Keep the target word in its example sentence. Definitions and examples may be blank if unavailable, but always provide the American IPA.
Always leave the fifth (audio) column blank. The app uses the device voice, so do not find or invent audio links.
Quote definition fields. Quote any other field containing a comma or double quote, escaping an internal quote by doubling it. Keep every field on one line. No Markdown, numbering or commentary.

My words:
[Paste your words here]`;
$('ai-prompt').value=formattingPrompt;
function openAIPrompt(){if($('import-dialog').open)$('import-dialog').close();$('ai-status').textContent='';$('ai-dialog').showModal();}
$('import-ai-prompt').onclick=openAIPrompt;
$('copy-ai-prompt').onclick=async()=>{try{await navigator.clipboard.writeText(formattingPrompt);$('ai-status').textContent='Prompt copied. Paste it into your AI tool and add your words.';}catch{$('ai-prompt').focus();$('ai-prompt').select();$('ai-status').textContent='Select and copy the prompt above.';}};

showStudio().catch(e=>{if(e.status!==401)$('login-status').textContent=e.message;});
