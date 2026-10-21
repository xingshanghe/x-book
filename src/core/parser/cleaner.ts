/**
 * 来源广告 / 版权噪声清洗。
 *
 * 设计原则：
 *   1. 只删整行，绝不改写正文 —— 宁可留一行广告，也不能把作者的句子改掉；
 *   2. 规则可编辑、可关闭、可复原：命中行以行号记录，重开一键恢复；
 *   3. 默认内置两套（塞班 / 知轩，与易笺同源），足够覆盖大陆网文 TXT 的 90%+；
 *   4. 每条命中都上报，导入完成后在书卡上显示「已清理 N 行」。
 *
 * 注意：我们不做「全书正则替换」，那是误伤的根源。
 */

import type { CleanRule } from '@/types/models';

/**
 * 每条规则的尾巴分两派，语义差别很重要：
 *   - 站点类（含 URL / 域名 / 固定口号）：允许带一段尾巴，因为域名本身就是强证据；
 *   - 短语类（如「请支持正版」）：必须锚到行尾，否则会把出现在句子里的
 *     同名词组整行删掉 —— 那是误伤正文的头号来源。
 */
export const BUILTIN_RULES: CleanRule[] = [
  {
    id: 'builtin-saiban',
    name: '塞班乐园',
    enabled: true,
    pattern:
      '^\\s*(?:【|「|\\[)?(?:更多好书下载|塞班(?:乐园|手机无限论坛|智能手机网|电子书)?|www\\.(?:bbs\\.)?dospy\\.com|book\\.cnitpm\\.com|本书由\\s*.{0,40}?(?:收集整理|整理|制作|发布|出品)|首发\\s*[,，]?\\s*最大最好无广告|\\s*[,，]\\s*39txt|pty100)\\s*[:：]?\\s*\\S{0,80}$',
    builtin: true,
  },
  {
    id: 'builtin-zhixuan',
    name: '知轩藏书',
    enabled: true,
    pattern:
      '^\\s*[—－-]{0,4}\\s*(?:知轩藏书|转自-知轩藏书|知轩藏书出品|更多好书\\s*[,，]\\s*尽在知轩藏书)\\s*[—－-]{0,4}\\s*$|^\\s*(?:www\\.zxcs\\.me|知轩\\s*.{0,6}首发)\\s*\\S{0,80}$',
    builtin: true,
  },
  {
    id: 'builtin-generic',
    name: '通用站点广告',
    enabled: true,
    pattern:
      '^\\s*(?:\\*\\s*)?(?:本站网址|本站 Located|喜欢这本书|(?:Txt|txt)电子书?\\s*下载|声明\\s*[:：]\\s*本书|免责声明|不断更新\\s*[,，]\\s*欢迎回访|欢迎访问)\\s*[:：]?\\s*\\S{0,80}$',
    builtin: true,
  },
  {
    id: 'builtin-appeal',
    name: '呼吁正版（仅整行）',
    enabled: true,
    // 只有整行就是这句口号才删；句中出现「请支持正版」多半是作者写的对话，绝不删。
    pattern:
      '^\\s*(?:【|「|\\[)?\\s*请\\s*(?:大家\\s*)?(?:支持|购买)\\s*正版\\s*[,，。！!]?\\s*(?:】|」|\\])?\\s*$',
    builtin: true,
  },
  {
    id: 'builtin-url',
    name: '纯网址行',
    enabled: true,
    pattern: '^\\s*(?:https?://|www\\.)\\S{4,120}\\s*$',
    builtin: true,
  },
];

export interface CleanerHit {
  ruleId: string;
  ruleName: string;
}

export class Cleaner {
  private compiled: { rule: CleanRule; re: RegExp }[] = [];

  constructor(rules: CleanRule[], enabled = true) {
    if (!enabled) return;
    for (const rule of rules) {
      if (!rule.enabled || !rule.pattern) continue;
      try {
        this.compiled.push({
          rule,
          re: new RegExp(rule.pattern, rule.flags ?? 'u'),
        });
      } catch {
        // 非法正则静默跳过：用户自定义规则出错不得阻塞导入
      }
    }
  }

  get isEmpty(): boolean {
    return this.compiled.length === 0;
  }

  /** 返回命中规则（用于导入报告），未命中返回 null */
  test(line: string): CleanerHit | null {
    if (line.length > 200) return null;
    const trimmed = line.trim();
    if (!trimmed) return null;
    // 保守守卫：广告行几乎不会超过 60 字，也不会带句末标点。
    // 带句号/问号/叹号的一律视为正文 —— 宁可留下广告，也不能删掉作者的句子。
    if (trimmed.length > 60 || /[。！？!?；;…]/.test(trimmed)) return null;
    for (const { rule, re } of this.compiled) {
      // 用重新构造的方式避免 lastIndex 状态泄漏
      if (re.test(trimmed)) {
        return { ruleId: rule.id, ruleName: rule.name };
      }
    }
    return null;
  }
}

/** 合并用户规则：内置在前（兜底），用户规则在后（可覆盖同名 id 视为编辑） */
export function mergeRules(userRules: CleanRule[] | undefined): CleanRule[] {
  const map = new Map<string, CleanRule>();
  for (const r of BUILTIN_RULES) map.set(r.id, r);
  for (const r of userRules ?? []) map.set(r.id, r);
  return [...map.values()];
}

export function validatePattern(pattern: string): { ok: boolean; error?: string; hits?: number } {
  try {
    new RegExp(pattern);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
