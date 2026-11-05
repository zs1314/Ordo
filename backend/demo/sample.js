// The demo site's data: all made up, none of it from a real board. All times count back and forward from the moment the page
// opens, so the board looks in use whenever it is opened; today's check-ins are all still open and the agent items are all still
// handed off, so visitors can click around themselves. The appearance copies the settings of a board in daily use, for a
// lived-in look.
import { ymd } from "../web/lib/due.js";
import { repeatDay } from "../web/lib/repeat.js";

const MIN = 60e3, H = 60 * MIN, D = 24 * H;

export const THEME = {
  mode: "auto", font: "default", fontSize: 15, width: 1040, radius: 12, density: "comfortable", layout: "stacked",
  showStats: true, title: "Axi's ToDo", accent: "", customCss: "", showCalendar: true, showRepeat: true,
  hero: true, heroStyle: "landscape", heroHeight: 200, agentCols: 3, showToc: true,
  closedMode: "recent", recentDays: 1, showDone: true, doneChart: "bars", agentFx: "dust", checkFx: "confetti",
};

// Done items: [title, days since done], in order of completion within each card
const DONE = {
  "g-paper": [["定下故事线和三条贡献", 40], ["把评测脚本统一成一份", 33], ["跑通 baseline，对上原论文的数", 26], ["整理数据集的统计表", 19],
    ["主实验跑完三个随机种子", 12], ["画训练曲线的对比图", 6], ["摘要初稿", 3], ["写完实验设置那一节", 0]],
  "g-code": [["删掉没用的分支", 61], ["配置文件拆成几层", 47], ["加上断点续训", 30], ["换成 bf16 训练", 22], ["数据预处理改成多进程", 13],
    ["修好评测时随机种子没固定的问题", 8], ["日志里多记一列学习率", 5], ["训练曲线自动发到看板", 1]],
  "g-read": [["参考文献导进 Zotero", 52], ["给读过的论文打标签", 24], ["读完那篇综述的第三章", 10], ["整理上周的阅读笔记", 6]],
  "g-course": [["退掉一门不想上的选修", 58], ["机器学习：作业 1", 37], ["数值分析：第 3 章习题", 28], ["操作系统：实验 1 报告", 18],
    ["机器学习：作业 2", 12], ["数值分析：第 4 章习题", 2]],
  "g-daily": [["办好图书馆的借书证", 66], ["体检", 44], ["给手机换电池", 35], ["理发", 20], ["买换季的衣服", 11], ["修自行车的刹车", 7],
    ["洗被套", 1], ["交电费", 0]],
  "g-trip": [["订国庆的车票", 49], ["国庆的照片整理成相册", 27], ["查好周末爬山的路线", 5]],
  "g-blog": [["博客加上评论区", 70], ["博客的字号调大一点", 55], ["博客的图片换成 WebP", 31], ["修友链页在手机上的排版", 13], ["写完上个月的论文清单", 1]],
};

export function sampleDoc(now = new Date()) {
  const t0 = now.getTime(), iso = (ms) => new Date(ms).toISOString(), ago = (ms) => iso(t0 - ms);
  const y = now.getFullYear(), mo = now.getMonth(), d = now.getDate();
  // An hh:mm on the day back days ago; for today, a time between midnight and now (the factor is the position within that span),
  // so it is never in the future
  const doneAt = (back, k) => {
    if (back === 0) { const day0 = new Date(y, mo, d).getTime(); return iso(day0 + (t0 - day0) * (0.45 + 0.25 * (k % 2))); }
    return iso(new Date(y, mo, d - back, 10 + ((k * 5) % 12), (k * 17) % 60).getTime());
  };
  const due = (days, time = "") => `${ymd(new Date(y, mo, d + days))}${time ? ` ${time}` : ""}`;
  // Recurring items: of the scheduled days in the last back days, the most recent streak of them are all checked in and earlier
  // ones at a rate of 1 - miss; "today" (by repeat.time) is left unchecked
  const checkins = (repeat, { back = 56, streak = 4, miss = 0.25, seed = 1 } = {}) => {
    const t = repeatDay(repeat, now), base = new Date(t.getFullYear(), t.getMonth(), t.getDate()), out = [];
    let n = 0;
    for (let k = 1; k <= back; k++) {
      const day = new Date(base.getFullYear(), base.getMonth(), base.getDate() - k);
      if (!repeat.days.includes(day.getDay())) continue;
      n++;
      const r = ((n * 7919 + seed * 104729) % 1000) / 1000; // fixed pseudo-random numbers, so every visitor sees the same data
      if (n <= streak || r >= miss) out.push(ymd(day));
    }
    return out.sort();
  };

  const sections = [
    { id: "s-research", title: "科研", sub: "投稿、实验、每天读的论文" },
    { id: "s-course", title: "课程", sub: "作业从 Canvas 同步过来" },
    { id: "s-life", title: "生活", sub: "" },
    { id: "s-blog", title: "博客", sub: "[axi404.top](https://axi404.top/)" },
  ].map((s, k) => ({ ...s, order: (k + 1) * 10, hidden: false }));
  const groups = [
    ["g-paper", "s-research", "投稿：会议论文"], ["g-code", "s-research", "实验与代码"], ["g-read", "s-research", "读论文"],
    ["g-course", "s-course", "本学期作业"],
    ["g-daily", "s-life", "日常"], ["g-trip", "s-life", "出门"],
    ["g-blog", "s-blog", "写作"],
  ].map(([id, section, title]) => ({ id, section, title, note: "" }));

  const items = [];
  let n = 0;
  const add = (group, title, status, { created = 5 * D, note = "", ...rest } = {}) =>
    items.push({ id: `t${String(++n).padStart(2, "0")}`, group, title, status, note, createdAt: ago(created), updatedAt: ago(Math.min(created, 2 * H)), ...rest });
  const agent = (where, sinceMs, seenMs, note = "") => ({ where, note, since: ago(sinceMs), lastSeen: ago(seenMs) });

  // Research
  add("g-paper", "补消融实验：去掉数据增强再跑一遍", "agent", { created: 4 * D, agent: agent("pi · 服务器", 20 * H, 2 * H, "三个随机种子，跑完把表格更新到 Overleaf") });
  add("g-paper", "主实验的结果整理成 LaTeX 表格", "agent", { created: 1 * D, agent: agent("Claude Code", 3 * H, 50 * MIN) });
  add("g-paper", "写方法那一节", "doing", { created: 9 * D, due: due(6) });
  add("g-paper", "相关工作补上今年的三篇", "todo", { created: 6 * D, due: due(9), note: "先看近半年 arXiv 上的" });
  add("g-paper", "合作者看一遍引言", "waiting", { created: 3 * D, waitingOn: "合作者的修改意见" });
  add("g-paper", "提交论文", "todo", { created: 30 * D, due: due(16, "23:59 AoE") });
  add("g-code", "排查训练到一半 loss 变成 NaN", "agent", { created: 3 * D, agent: agent("pi · 服务器", 2 * D, 27 * H, "先看是不是某一批数据有问题") });
  add("g-code", "清理旧的 checkpoint，腾点硬盘", "todo", { created: 8 * D });
  add("g-code", "评测结果加上置信区间", "todo", { created: 4 * D });
  add("g-code", "试试更大的 batch size", "dropped", { created: 14 * D, reason: "显存不够，先不试" });
  const paper = { days: [1, 2, 3, 4, 5], time: "12:00" }, arxiv = { days: [0, 1, 2, 3, 4, 5, 6], time: "09:00" };
  add("g-read", "读一篇论文，写三行笔记", "todo", { created: 60 * D, repeat: paper, doneDates: checkins(paper, { streak: 6, miss: 0.15, seed: 2 }) });
  add("g-read", "整理当天 arXiv 上相关的新论文", "agent", { created: 12 * D, repeat: arxiv, doneDates: checkins(arxiv, { back: 12, streak: 9, miss: 0.2, seed: 3 }),
    agent: agent("pi · 笔记本", 12 * D, 90 * MIN, "挑出和机器人学习相关的，每篇写一句话") });
  add("g-read", "这个月读的论文整理成一篇博客", "todo", { created: 10 * D });
  // Courses
  add("g-course", "操作系统：实验 2 报告", "doing", { created: 12 * D, due: due(1, "23:59"), note: "要附上运行截图" });
  add("g-course", "机器学习：作业 3", "todo", { created: 9 * D, due: due(3, "23:59") });
  add("g-course", "数值分析：第 5 章习题", "todo", { created: 5 * D, due: due(8) });
  add("g-course", "期中复习：数值分析", "todo", { created: 5 * D, due: due(14) });
  add("g-course", "课程项目分组", "waiting", { created: 6 * D, waitingOn: "队友确认选题" });
  // Life
  const run = { days: [1, 3, 5] }, words = { days: [0, 1, 2, 3, 4, 5, 6] };
  add("g-daily", "跑步 30 分钟", "todo", { created: 50 * D, repeat: run, doneDates: checkins(run, { streak: 3, miss: 0.3, seed: 5 }) });
  add("g-daily", "背 20 个单词", "todo", { created: 40 * D, repeat: words, doneDates: checkins(words, { back: 40, streak: 11, miss: 0.2, seed: 7 }) });
  add("g-daily", "报销上个月的打车票", "todo", { created: 9 * D, due: due(-1) });
  add("g-daily", "给家里打个电话", "todo", { created: 2 * D });
  add("g-daily", "退掉买错的耳机", "waiting", { created: 4 * D, waitingOn: "商家收到货退款" });
  add("g-trip", "订下次回家的火车票", "todo", { created: 3 * D, due: due(10) });
  add("g-trip", "护照快过期了，预约换一本", "todo", { created: 20 * D });
  // Blog
  add("g-blog", "写一篇：我怎么和 Agent 一起用这个 ToDo", "doing", { created: 4 * D });
  add("g-blog", "博客的 RSS 输出全文", "agent", { created: 5 * H, agent: agent("Codex", 5 * H, 5 * H) });
  add("g-blog", "整理今年读过的书", "todo", { created: 15 * D });
  add("g-blog", "博客换个主题", "dropped", { created: 30 * D, reason: "现在这个挺好" });
  // Done items
  let k = 0;
  for (const [group, list] of Object.entries(DONE)) {
    for (const [title, back] of list) {
      const at = doneAt(back, k++);
      items.push({ id: `t${String(++n).padStart(2, "0")}`, group, title, status: "done", note: "", createdAt: iso(Date.parse(at) - (2 + (k % 6)) * D), updatedAt: at, doneAt: at });
    }
  }
  // Dropped items get a time as well
  for (const i of items) if (i.status === "dropped") i.updatedAt = ago(i.title.includes("batch") ? 9 * D : 15 * D);

  return {
    version: 2, rev: 1, updatedAt: ago(4 * MIN), sections, groups, items,
    extras: { yearGoalsTitle: "", yearGoals: ["发一篇一作论文", "跑一次半马", "读完 24 本书", "博客每个月至少写一篇", "学会做五道家常菜"] },
    theme: { ...THEME },
    settings: { staleHours: 12, canvasGroup: "g-course" },
    places: [
      { name: "pi · 服务器", lastUsed: ago(20 * H), uses: 17 },
      { name: "Claude Code", lastUsed: ago(3 * H), uses: 8 },
      { name: "Codex", lastUsed: ago(5 * H), uses: 4 },
      { name: "pi · 笔记本", lastUsed: ago(12 * D), uses: 11 },
    ],
  };
}
