export type InspirationGenreId = "historical" | "urban" | "fantasy" | "suspense" | "romance_ancient";

export type InspirationChoice = {
  id: string;
  label: string;
  description: string;
};

export type InspirationStorySeed = {
  id: string;
  label: string;
  setup: string;
  sub_genres: string[];
  tropes: string[];
};

export type InspirationProtagonistTemplate = {
  id: string;
  role_identity: string;
  strength: string;
  weakness: string;
  sub_genres: string[];
  tropes: string[];
};

export type InspirationGenreTaxonomy = {
  id: InspirationGenreId;
  label: string;
  description: string;
  sub_genres: InspirationChoice[];
  tropes: InspirationChoice[];
  story_seeds: InspirationStorySeed[];
  protagonist_templates: InspirationProtagonistTemplate[];
};

type RawTemplate = {
  role_identity: string;
  strength: string;
  weakness: string;
};

type RawGenre = {
  id: InspirationGenreId;
  label: string;
  description: string;
  sub_genres: string[];
  tropes: string[];
  story_seeds: string[];
  protagonist_templates: RawTemplate[];
};

function buildChoiceId(genreId: string, type: string, index: number) {
  return `${genreId}-${type}-${String(index + 1).padStart(2, "0")}`;
}

function buildChoices(genreId: string, type: string, labels: string[]) {
  return labels.map((label, index) => ({
    id: buildChoiceId(genreId, type, index),
    label,
    description: `${label}方向`,
  }));
}

function buildStorySeeds(genreId: string, storySeeds: string[]): InspirationStorySeed[] {
  return storySeeds.map((setup, index) => ({
    id: buildChoiceId(genreId, "seed", index),
    label: setup,
    setup,
    sub_genres: [],
    tropes: [],
  }));
}

function buildProtagonists(genreId: string, templates: RawTemplate[]): InspirationProtagonistTemplate[] {
  return templates.map((template, index) => ({
    id: buildChoiceId(genreId, "protagonist", index),
    role_identity: template.role_identity,
    strength: template.strength,
    weakness: template.weakness,
    sub_genres: [],
    tropes: [],
  }));
}

const rawCatalog: RawGenre[] = [
  {
    id: "historical",
    label: "历史",
    description: "从朝堂、军政和旧案里起局，适合强冲突开场。",
    sub_genres: ["权谋", "破案", "战争", "经商", "宫廷", "小人物逆袭"],
    tropes: ["穿越", "重生", "查案", "智斗", "经营", "朝堂斗争", "乱世", "世家门阀", "边军", "反转", "打脸", "逆袭"],
    story_seeds: [
      "官仓亏空十万石粮",
      "军粮在半路失踪",
      "洛阳粮价一夜暴涨",
      "太子突然失踪",
      "皇城命案无人敢查",
      "流民冲城前夕粮仓失火",
      "边军断粮",
      "科举舞弊案",
      "盐商垄断盐价",
      "宫中密信外泄",
      "边关军械失踪",
      "皇帝遇刺",
      "世家私盐案",
      "河道漕运失踪案",
      "军费假账",
      "皇城仓库被盗",
      "边关谍报泄露",
      "太守贪墨案",
      "禁军军械案",
      "朝堂密谋",
    ],
    protagonist_templates: [
      { role_identity: "穿越差役", strength: "熟悉底层规矩，跑现场快，最会从细碎消息里找线索。", weakness: "身份低微，稍有差池就容易被推出去顶罪。" },
      { role_identity: "寒门主簿", strength: "擅长账目、文书和流程，能从假账里反推真相。", weakness: "背后没人，一旦得罪权贵就很难翻身。" },
      { role_identity: "落魄书生", strength: "脑子快，善于判断局势，也敢赌关键一步。", weakness: "手上没有实权，前期多半只能借势行事。" },
      { role_identity: "世家弃子", strength: "懂门阀规则，也知道世家最怕什么。", weakness: "旧身份既是筹码，也是随时会反噬的包袱。" },
      { role_identity: "边军校尉", strength: "熟悉军情和边地人心，临场应变强。", weakness: "太相信军中情义，容易被旧同袍拖累判断。" },
      { role_identity: "商贾庶子", strength: "懂钱路、人情和交易，最会在夹缝里找活路。", weakness: "身份尴尬，既得不到家族信任，也很难被官面接纳。" },
      { role_identity: "女官", strength: "心细、稳得住场，还能从礼制和内廷细节里看破局。", weakness: "一旦站错边，代价往往比别人更重。" },
      { role_identity: "仵作", strength: "最懂尸体和现场细节，能先一步发现别人忽略的证据。", weakness: "地位卑微，真相越大，越容易被灭口。" },
    ],
  },
  {
    id: "urban",
    label: "都市",
    description: "从现实压力、职场冲突和现代异常事件切入，节奏直接。",
    sub_genres: ["都市脑洞", "职场", "神豪", "都市高武", "现实成长", "创业"],
    tropes: ["系统", "神豪", "逆袭", "创业", "职场斗争", "赚钱", "爽文", "高武", "打脸", "成长", "复仇", "都市冒险"],
    story_seeds: [
      "普通社畜获得神秘系统",
      "创业失败后重来一次",
      "公司财务突然发现巨额黑账",
      "一夜之间继承巨额财富",
      "直播意外爆火",
      "公司高层离奇失踪",
      "一个普通人获得未来信息",
      "小公司突然卷入商业阴谋",
      "医生发现医院秘密",
      "程序员发现数据造假",
      "律师接到奇怪案件",
      "普通保安发现犯罪集团",
      "直播间意外发现犯罪线索",
      "社畜得到时间循环能力",
      "突然获得超能力",
      "创业项目被偷",
      "金融骗局曝光",
      "股市神秘操盘",
      "企业并购大战",
      "地下资本战争",
    ],
    protagonist_templates: [
      { role_identity: "普通社畜", strength: "能扛压，也最懂办公室和现实里的细小规则。", weakness: "长期压抑自己，关键时刻容易先怀疑自己。" },
      { role_identity: "创业失败者", strength: "吃过亏，执行力和复盘能力都很强。", weakness: "一见机会就想翻盘，容易再次赌过头。" },
      { role_identity: "财务主管", strength: "对数字和漏洞极敏感，最能看出谁在做假账。", weakness: "过于谨慎，前期常常错过最好的出手机会。" },
      { role_identity: "新晋神豪", strength: "资源调动快，敢下重手，也不缺试错空间。", weakness: "突然有钱后容易高估自己对规则的掌控力。" },
      { role_identity: "急诊医生", strength: "高压之下也能快速判断，最会在混乱里稳场。", weakness: "见不得人出事，一旦失败就会背很久。" },
      { role_identity: "程序员", strength: "逻辑强，能从数据和系统细节里抓出真问题。", weakness: "不擅长人情周旋，常被办公室政治拖慢节奏。" },
      { role_identity: "青年律师", strength: "会拆规则，也会从口供和合同里找突破口。", weakness: "太想证明自己，容易在关键局里押太重。" },
      { role_identity: "普通保安", strength: "熟悉现场、动线和每个不起眼的人，观察力强。", weakness: "资源太少，一旦卷进大事最先被忽视和牺牲。" },
    ],
  },
  {
    id: "fantasy",
    label: "玄幻",
    description: "从修炼、宗门和秘境异变起手，适合强升级和大场面推进。",
    sub_genres: ["修炼", "宗门", "秘境", "炼丹", "妖兽", "大陆争霸"],
    tropes: ["系统", "升级", "天才", "废柴逆袭", "宗门争霸", "秘境", "神器", "血脉觉醒", "炼丹", "收徒", "冒险", "复仇"],
    story_seeds: [
      "宗门测试灵根",
      "被逐出宗门",
      "秘境开启",
      "妖兽暴动",
      "宗门大比",
      "神器现世",
      "天才被陷害",
      "宗门大战",
      "上古遗迹",
      "炼丹大赛",
      "魔宗崛起",
      "妖族入侵",
      "大陆灵气复苏",
      "禁地开启",
      "秘境试炼",
      "宗门叛徒",
      "血脉觉醒",
      "宗门传承争夺",
      "上古封印破裂",
      "魔族复苏",
    ],
    protagonist_templates: [
      { role_identity: "废柴弟子", strength: "够能忍，也更懂底层修炼者怎么活下来。", weakness: "前期资源太少，稍有失误就会被彻底踩死。" },
      { role_identity: "外门杂役", strength: "熟悉宗门角落和杂务链条，最会从边缘找到机会。", weakness: "地位太低，很多真相看见了也未必能说。"},
      { role_identity: "炼丹学徒", strength: "手稳、心细，对药性和资源变化最敏感。", weakness: "正面战力偏弱，前期很难硬碰硬。"},
      { role_identity: "妖兽猎人", strength: "野外生存和追踪能力极强，实战经验够狠。", weakness: "太相信直觉，容易被更复杂的人局套住。"},
      { role_identity: "宗门弃子", strength: "既懂宗门规则，又知道高层最怕什么。", weakness: "对旧宗门执念很深，关键时刻容易被过去牵住。"},
      { role_identity: "皇朝质子", strength: "见识广，懂权势和大势，也会隐忍。", weakness: "身份天然危险，谁都能拿他去交换利益。"},
      { role_identity: "落魄天才", strength: "天赋和眼界都在，一旦翻身会非常快。", weakness: "过去摔得太狠，对失败有本能恐惧。"},
      { role_identity: "古族后人", strength: "天生带着别人没有的传承和底牌。", weakness: "血脉秘密本身就是最大的追杀源头。"},
    ],
  },
  {
    id: "suspense",
    label: "悬疑",
    description: "从案件、谜团和心理压迫起局，强调线索推进和反转。",
    sub_genres: ["刑侦", "推理", "惊悚", "心理", "密室", "都市悬疑"],
    tropes: ["破案", "心理战", "反转", "高智商", "谜题", "密室", "追凶", "连环案件", "真相", "卧底", "推理", "追捕"],
    story_seeds: [
      "密室命案",
      "连环失踪案",
      "十年前旧案重启",
      "一具无名尸体",
      "失踪的列车乘客",
      "深夜电话案件",
      "小镇连环命案",
      "失踪的证人",
      "匿名信威胁",
      "诡异录像带",
      "警方内部叛徒",
      "地下组织",
      "精神病院秘密",
      "消失的档案",
      "死亡直播",
      "时间循环杀人案",
      "AI预测犯罪",
      "杀人预告信",
      "未解悬案",
      "模仿犯罪",
    ],
    protagonist_templates: [
      { role_identity: "刑警", strength: "跑案子快，扛压强，面对混乱也能先稳住节奏。", weakness: "太想尽快抓人，偶尔会忽略更深的一层真相。" },
      { role_identity: "法医", strength: "最懂尸体和现场细节，能从极小异常里找到突破口。", weakness: "一旦案件碰到熟人，情绪会明显影响判断。" },
      { role_identity: "心理侧写师", strength: "擅长从言行偏差里拼出作案心理。", weakness: "太相信自己的判断时，容易在错误方向越走越深。" },
      { role_identity: "记者", strength: "信息源多，动作快，最容易抢到第一现场。", weakness: "太想抢真相，常把自己送进危险中心。" },
      { role_identity: "律师", strength: "熟规则，会拆口供和证据链。", weakness: "总想两头都保住，反而更容易被夹住。"},
      { role_identity: "普通目击者", strength: "局外人视角干净，最容易发现别人默认忽略的异常。", weakness: "没有资源，一旦被盯上很难自保。"},
      { role_identity: "前卧底", strength: "懂黑暗规则，也懂怎么跟最危险的人打交道。", weakness: "过去身份太脏，谁都可能借旧账反咬他。"},
      { role_identity: "推理作家", strength: "擅长建模和还原案件逻辑，能快速拼图。", weakness: "习惯站在观察位，真卷进现实时反应会慢半拍。"},
    ],
  },
  {
    id: "romance_ancient",
    label: "古言",
    description: "从婚约、宫斗和身份压迫切入，让感情线和局势一起收紧。",
    sub_genres: ["宫斗", "宅斗", "甜宠", "复仇", "权谋", "种田"],
    tropes: ["重生", "替嫁", "退婚", "甜宠", "宫斗", "宅斗", "复仇", "萌宝", "逆袭", "先婚后爱", "打脸", "成长"],
    story_seeds: [
      "重生回到出嫁前",
      "替姐姐出嫁",
      "被退婚",
      "宫廷争宠",
      "世家嫡庶斗争",
      "被流放",
      "假死归来",
      "皇子争位",
      "贵妃失宠",
      "庶女逆袭",
      "宫廷秘密",
      "侯府内斗",
      "太子妃之争",
      "女官升迁",
      "世家婚约",
      "家族复仇",
      "皇宫密谋",
      "边关婚约",
      "王爷选妃",
      "宫中命案",
    ],
    protagonist_templates: [
      { role_identity: "重生嫡女", strength: "知道旧局和关键人心，出手更稳更狠。", weakness: "前世阴影太重，越在乎的人越容易让她失控。" },
      { role_identity: "替嫁庶女", strength: "能忍也会看人脸色，最会在夹缝里活下来。", weakness: "身份太弱，很多局一开始就不占理。" },
      { role_identity: "被退婚的小姐", strength: "脸面摔过一次后更知道怎么翻盘和反击。", weakness: "自尊心太强，表面越稳心里越不肯低头。" },
      { role_identity: "冷宫公主", strength: "看惯人情冷暖，判断人心很准。", weakness: "太习惯不信人，真正有机会时也容易错过。" },
      { role_identity: "侯府嫡女", strength: "懂礼法、懂宅斗，也懂怎么借规矩反制别人。", weakness: "背着家族包袱，很多选择并不真的自由。" },
      { role_identity: "女官", strength: "执行力强，擅长在宫廷和权场里稳住局面。", weakness: "太习惯理性做事，真正动情时反而不会表达。" },
      { role_identity: "流放女眷", strength: "吃苦能力强，越到绝境越能撑出路。", weakness: "前期资源几乎为零，翻身必须拿命去换。" },
      { role_identity: "小掌柜", strength: "会算账、会经营，也最懂日子怎么一点点翻起来。", weakness: "太看重眼前生计，有时不敢赌真正想要的人和局。"},
    ],
  },
];

export const inspirationCatalog: InspirationGenreTaxonomy[] = rawCatalog.map((genre) => ({
  id: genre.id,
  label: genre.label,
  description: genre.description,
  sub_genres: buildChoices(genre.id, "sub", genre.sub_genres),
  tropes: buildChoices(genre.id, "trope", genre.tropes),
  story_seeds: buildStorySeeds(genre.id, genre.story_seeds),
  protagonist_templates: buildProtagonists(genre.id, genre.protagonist_templates),
}));

export function getInspirationGenre(genreId: string) {
  return inspirationCatalog.find((genre) => genre.id === genreId);
}
