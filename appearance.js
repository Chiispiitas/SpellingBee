/* Shared school colors. Derived colors stay in one place for all app views. */
window.BeeAppearance=(()=>{
 const palettes={midnight:{accent:'#64dfcf',background:'#101b2c',windowColor:'#182638'},slate:{accent:'#9fc8ee',background:'#26384b',windowColor:'#34495d'},ivory:{accent:'#375c86',background:'#f0eee7',windowColor:'#ffffff'},forest:{accent:'#a3d6b4',background:'#123a31',windowColor:'#1c493e'},plum:{accent:'#dcb5e8',background:'#34233f',windowColor:'#46314e'}};
 const rgb=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16));
 const luminance=h=>rgb(h).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
 const contrast=(a,b)=>(Math.max(luminance(a),luminance(b))+.05)/(Math.min(luminance(a),luminance(b))+.05);
 const ink=h=>contrast(h,'#17212b')>contrast(h,'#f5f7fa')?'#17212b':'#f5f7fa';
 const mix=(a,b,t)=>'#'+rgb(a).map((v,i)=>Math.round(v*(1-t)+rgb(b)[i]*t).toString(16).padStart(2,'0')).join('');
 function colors(s){const p=palettes[s.theme]||palettes.midnight,bg=s.background||p.background,win=s.windowColor||p.windowColor,a=s.accent||p.accent,f=ink(win),base=ink(bg);return {bg,win,a,f,base,muted:mix(win,f,.68),line:mix(win,f,.25),soft:mix(win,f,.07),accentInk:ink(a),accentText:contrast(a,win)>=4.5?a:f,ok:luminance(win)>.45?'#23633d':'#9bd4ad',err:luminance(win)>.45?'#9a2936':'#f2a0a7'};}
 function apply(s){const c=colors(s),v={'--ui-bg':c.bg,'--ui-window':c.win,'--ui-fg':c.f,'--ui-page-fg':c.base,'--ui-muted':c.muted,'--ui-line':c.line,'--ui-soft':c.soft,'--ui-accent':c.a,'--ui-accent-ink':c.accentInk,'--ui-accent-text':c.accentText,'--ui-ok':c.ok,'--ui-err':c.err,'--bg':c.bg,'--product-bg':c.bg,'--fg':c.base,'--muted':c.muted,'--accent':c.a,'--gold':c.a,'--panel':c.win,'--control-card':c.win,'--control-border':c.line,'--ok':c.ok,'--err':c.err};for(const k in v)document.documentElement.style.setProperty(k,v[k]);document.documentElement.style.colorScheme=luminance(c.win)>.45?'light':'dark';document.documentElement.dataset.schoolTheme=s.theme;return c;}
 function applyWorkspace(s){const c=apply({theme:'workspace',background:'#f1f3f4',windowColor:'#ffffff',accent:s.accent});document.documentElement.dataset.workspace='light';return c;}
 return {palettes,colors,apply,applyWorkspace,contrast};
})();
