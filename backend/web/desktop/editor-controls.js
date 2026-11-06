import { html, useState, useRef, useLayoutEffect } from '../vendor/preact-htm.js';
import { Icon } from './icons.js';
import { dayOf, dateLabel, todayKey, tomorrowKey } from './model.js';
import { monthCells, ymd } from '../lib/due.js';

const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.desktopMotion === 'reduced';

export function AutoTextarea({ value, class: cls = '', ...props }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const el = ref.current;
    el.style.height = '0px';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return html`<textarea ref=${ref} rows="1" class=${cls} value=${value} ...${props} />`;
}

// Keep native details semantics; animate both directions and allow interruption.
export function Disclosure({ summary, children, class: cls = '', open, onToggle }) {
  const [local, setLocal] = useState(false);
  const expanded = open ?? local;
  const ref = useRef(null), animation = useRef(null), previous = useRef(expanded);
  useLayoutEffect(() => {
    const el = ref.current;
    if (previous.current === expanded) { el.open = expanded; return; }
    previous.current = expanded;
    const start = el.getBoundingClientRect().height;
    animation.current?.cancel();
    el.style.height = ''; el.style.overflow = '';
    el.open = expanded;
    const end = el.getBoundingClientRect().height;
    if (reduceMotion()) return;
    el.open = true;
    el.style.overflow = 'hidden';
    const anim = el.animate([{height:`${start}px`}, {height:`${end}px`}], {duration:200,easing:'cubic-bezier(.2,.8,.2,1)'});
    animation.current = anim;
    anim.onfinish = () => { if(animation.current !== anim) return; el.open = expanded; el.style.overflow = ''; animation.current = null; };
  }, [expanded]);
  useLayoutEffect(() => () => animation.current?.cancel(), []);
  return html`<details ref=${ref} class=${cls} data-expanded=${expanded}><summary aria-expanded=${expanded} onClick=${e => {e.preventDefault();e.currentTarget.focus({preventScroll:true});onToggle ? onToggle(!expanded) : setLocal(!expanded);}}>${summary}</summary><div>${children}</div></details>`;
}

export function SelectField({ label, icon, value, onChange, children }) {
  return html`<div class="d-editor-select"><${Icon} name=${icon} size=${15}/><select aria-label=${label} value=${value} onChange=${onChange}>${children}</select><${Icon} name="down" size=${12}/></div>`;
}

export function DateField({ due, onChange }) {
  const [open,setOpen] = useState(false);
  const selected = dayOf({due}), today = todayKey();
  const initial = new Date(`${selected || today}T12:00:00`);
  const [month,setMonth] = useState(() => new Date(initial.getFullYear(),initial.getMonth(),1));
  const [cursor,setCursor] = useState(selected || today);
  const ref = useRef(null);
  const choose = key => {onChange(key);setOpen(false);ref.current?.querySelector('summary')?.focus({preventScroll:true});};
  const setExpanded = value => {
    if(value) {const date=new Date(`${selected || today}T12:00:00`);setMonth(new Date(date.getFullYear(),date.getMonth(),1));setCursor(selected || today);}
    setOpen(value);
  };
  const moveMonth = delta => {const date=new Date(month.getFullYear(),month.getMonth()+delta,1);setMonth(date);setCursor(ymd(date));};
  const navigate = e => {
    const offset = {ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7}[e.key];
    if(offset === undefined || !e.target.dataset.date) return;
    e.preventDefault();
    const date=new Date(`${e.target.dataset.date}T12:00:00`);date.setDate(date.getDate()+offset);
    const key=ymd(date);setCursor(key);setMonth(new Date(date.getFullYear(),date.getMonth(),1));
    requestAnimationFrame(()=>ref.current?.querySelector(`[data-date="${key}"]`)?.focus({preventScroll:true}));
  };
  const summary = html`<span class="d-property-label"><${Icon} name="calendar" size=${16}/>日期</span><span class=${`d-date-value ${due ? 'has-date' : ''}`}>${due ? dateLabel({due}) : '未设置'}<${Icon} name="down" size=${12}/></span>`;
  return html`<div ref=${ref} class="d-date-field-wrap" onKeyDown=${e=>{if(e.key==='Escape' && open){e.preventDefault();e.stopPropagation();setOpen(false);ref.current.querySelector('summary').focus({preventScroll:true});}}}>
    <${Disclosure} class="d-date-disclosure" summary=${summary} open=${open} onToggle=${setExpanded}>
      <div class="d-date-sheet">
        <div class="d-date-shortcuts">${[['今天',today],['明天',tomorrowKey()]].map(([label,key])=>html`<button type="button" onClick=${()=>choose(key)}>${label}</button>`)}<button type="button" aria-label="清除日期" onClick=${()=>choose('')}>不设日期</button></div>
        <div class="d-mini-month"><button type="button" aria-label="上个月" onClick=${()=>moveMonth(-1)}><${Icon} name="chevron" size=${15}/></button><strong>${month.getFullYear()} 年 ${month.getMonth()+1} 月</strong><button type="button" aria-label="下个月" onClick=${()=>moveMonth(1)}><${Icon} name="chevron" size=${15}/></button></div>
        <div class="d-mini-calendar" aria-label="选择日期" onKeyDown=${navigate}>${[...'一二三四五六日'].map(d=>html`<span class="d-mini-weekday">${d}</span>`)}${monthCells(month).map(date=>{
          const key=ymd(date);
          return html`<button type="button" data-date=${key} tabindex=${key===cursor ? 0 : -1} class=${`${date.getMonth()!==month.getMonth()?'outside':''} ${key===today?'today':''} ${key===selected?'selected':''}`} aria-label=${`${date.getFullYear()}年${date.getMonth()+1}月${date.getDate()}日`} aria-pressed=${key===selected} onClick=${()=>choose(key)}>${date.getDate()}</button>`;
        })}</div>
        <label class="d-direct-date">输入日期<input type="date" aria-label="输入完整日期" value=${selected} onChange=${e=>{if(e.target.value)choose(e.target.value);}}/></label>
      </div>
    <//>
  </div>`;
}
