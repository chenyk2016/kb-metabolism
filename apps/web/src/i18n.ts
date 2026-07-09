/**
 * 文案字典。v1 只出中文；键位即 en 的落点，翻译时补一份 en 对象即可。
 * 长句文案就近写在视图里，这里只收导航/动作/层级等复用词。
 */
const zh = {
  "nav.watch": "看",
  "nav.judge": "判",
  "nav.manage": "管",
  "nav.overview": "总览",
  "nav.notes": "笔记",
  "nav.signals": "信号",
  "nav.review": "过堂",
  "nav.triage": "分诊",
  "nav.chew": "消化",
  "nav.settings": "设置",
  "tier.L0": "L0 判断",
  "tier.L1": "L1 资料",
  "tier.inbox": "inbox",
  "tier.untriaged": "未分诊",
  "action.execute": "处决",
  "action.pardon": "赦免",
  "action.skip": "跳过",
  "action.save": "保存",
  "action.cancel": "取消",
  "action.confirm": "确认",
  "signal.kb_read": "读取（续命）",
  "signal.kb_cite": "引用（强续命）",
  "signal.kb_search": "检索",
  "signal.kb_add": "捕捉",
  "signal.kb_inject": "注入（不续命）",
  "signal.kb_ui": "界面（不续命）",
} as const;

export type MsgKey = keyof typeof zh;

export function t(key: MsgKey): string {
  return zh[key];
}

/** 信号工具名 → 中文标签；未知工具原样显示（协议可扩展，界面不崩） */
export function tSignal(tool: string): string {
  return (zh as Record<string, string>)[`signal.${tool}`] ?? tool;
}
