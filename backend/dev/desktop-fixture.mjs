import { ymd } from '../web/lib/due.js';
export function desktopFixture(doc) {
  const day = offset => { const d = new Date(); d.setDate(d.getDate()+offset); return ymd(d); };
  doc.sections = [{id:'inbox',title:'收件箱',order:10,sub:'先记下来，再慢慢安排'},{id:'work',title:'工作',order:20,sub:'让重要的事，向前一步'},{id:'life',title:'生活',order:30,sub:'也为自己留一点时间'}];
  doc.groups = doc.sections.map(s=>({id:s.id+'-list',section:s.id,title:s.title,plain:true,order:10}));
  const task=(id,title,group,extra={})=>({id,title,group:group+'-list',status:'todo',note:'',order:10+doc.items.length,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),...extra});
  doc.items=[];
  doc.items=[
    task('design','整理新产品的设计方向','work',{status:'doing',priority:3,due:day(0),tags:['设计'],subtasks:[{id:'a',title:'收集参考',done:true},{id:'b',title:'整理设计原则',done:false},{id:'c',title:'准备方案',done:false}],note:'留意留白、字重和每一次操作的反馈。'}),
    task('proposal','完成项目提案初稿','work',{due:day(0),priority:2,tags:['本周重点']}),
    task('read','读 20 分钟书','life',{repeat:{days:[0,1,2,3,4,5,6],time:''},doneDates:[day(-1),day(-2),day(-3)]}),
    task('walk','傍晚出去走一走','life',{due:day(0)}),
    task('weekend','计划周末的短途旅行','life',{due:day(2),note:'看看天气，选一条人少一点的路线。'}),
    task('ideas','记下脑海里闪过的好点子','inbox',{tags:['灵感']}),
    task('wait','和同事确认下一步安排','work',{status:'waiting',waitingOn:'等待设计评审反馈'}),
    task('done','整理桌面与工作空间','life',{status:'done',doneAt:new Date().toISOString()}),
  ];
  doc.items.forEach((i,n)=>i.order=(n+1)*10);
  doc.places=[]; doc.extras={};
  Object.assign(doc.theme,{title:'Ordo',accent:'#52785e',font:'system',hero:false,mode:'light',desktopMotion:'full',desktopStartView:'all',desktopShowDone:false});
}
