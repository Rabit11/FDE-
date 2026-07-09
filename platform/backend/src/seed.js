import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { CHANNEL_FLOWS, flowToString } from './channelFlows.js';

const prisma = new PrismaClient();

async function seedChannels() {
  for (const ch of CHANNEL_FLOWS) {
    await prisma.channel.upsert({
      where: { id: ch.id },
      update: { level: ch.level, dept: ch.dept, name: ch.name, flow: flowToString(ch.steps) },
      create: { id: ch.id, level: ch.level, dept: ch.dept, name: ch.name, flow: flowToString(ch.steps) },
    });
  }
}

const USERS = [
  { username: 'team_owner', password: 'Keyan@2026', name: '周明', role: 'project_team', teamRole: '项目责任人', org: '试飞中心', title: '项目责任人' },
  { username: 'team_tech', password: 'Keyan@2026', name: '张晓', role: 'project_team', teamRole: '技术责任人', org: '试飞中心', title: '技术责任人' },
  { username: 'team_pm', password: 'Keyan@2026', name: '赵明远', role: 'project_team', teamRole: '项目主管', org: '试飞中心', title: '项目主管' },
  { username: 'chief_l1', password: 'Keyan@2026', name: '张总师', role: 'chief_l1', org: '总部', title: '一级责任总师' },
  { username: 'chief_l2', password: 'Keyan@2026', name: '王总师', role: 'chief_l2', org: '试飞中心', title: '二级责任总师' },
  { username: 'mgmt_hq', password: 'Keyan@2026', name: '陈建国', role: 'mgmt_hq', org: '总部科技部', title: '总部处室处长' },
  { username: 'mgmt_unit', password: 'Keyan@2026', name: '王海涛', role: 'mgmt_unit', org: '试飞中心', title: '单位科技部长' },
  { username: 'finance', password: 'Keyan@2026', name: '刘财务', role: 'finance', org: '试飞中心', title: '单位财务主管' },
  { username: 'admin', password: 'Keyan@2026', name: '系统管理员', role: 'admin', org: '总部科技部', title: '超级管理员' },
  // 兼容旧演示账号
  { username: 'hq_admin', password: 'Keyan@2026', name: '陈建国', role: 'mgmt_hq', org: '总部科技部', title: '总部处室处长' },
  { username: 'owner_zhou', password: 'Keyan@2026', name: '周明', role: 'project_team', teamRole: '项目责任人', org: '试飞中心', title: '项目责任人' },
  { username: 'member_zhang', password: 'Keyan@2026', name: '张晓', role: 'project_team', teamRole: '技术责任人', org: '试飞中心', title: '技术责任人' },
  { username: 'dept_wang', password: 'Keyan@2026', name: '王海涛', role: 'mgmt_unit', org: '试飞中心', title: '单位科技部长' },
  { username: 'pm_zhao', password: 'Keyan@2026', name: '赵明远', role: 'project_team', teamRole: '项目主管', org: '试飞中心', title: '项目主管' },
];

const PROJECTS = [
  { id: 'p01', code: 'KY-2024-001', name: '宽体客机复合材料机翼结构优化研究', goal: '突破大尺寸复合材料机翼关键制造技术', level: '国家级', channelId: 'mjky', channelName: 'MJKY', org: '试飞中心', owner: '周明', techOwner: '张晓', pmName: '赵明远', chiefL1: '张总师', chiefL2: '王总师', phase: '实施', risk: 'yellow', budgetTotal: 3200, budgetSpent: 1850, budgetYear: 800, budgetYearSpent: 420, startDate: '2024-03-01', endDate: '2027-12-31', outcomeStatus: '技术储备待应用', status: '进行中', over100M: false, postEvalStatus: 'pending' },
  { id: 'p02', code: 'KY-2024-002', name: '航空发动机高温合金叶片寿命预测', goal: '建立叶片寿命预测模型与验证平台', level: '国家级', channelId: 'zdyf', channelName: '重点研发计划', org: '发动机公司', owner: '刘洋', phase: '实施', risk: 'red', budgetTotal: 5600, budgetSpent: 3200, budgetYear: 1200, budgetYearSpent: 680, startDate: '2024-01-15', endDate: '2026-06-30', outcomeStatus: '接续研发立项', status: '进行中', over100M: false, postEvalStatus: 'pending' },
  { id: 'p03', code: 'KY-2023-015', name: '民机适航审定关键技术攻关', goal: '形成适航审定技术体系与工具链', level: '国家级', channelId: '04zx', channelName: '04专项接续', org: '适航审定中心', owner: '孙伟', phase: '验收', risk: 'blue', budgetTotal: 8900, budgetSpent: 7200, budgetYear: 1500, budgetYearSpent: 1200, startDate: '2023-06-01', endDate: '2025-12-31', outcomeStatus: '已转化应用', status: '已通过公司级验收', over100M: false, postEvalStatus: 'in_progress' },
  { id: 'p04', code: 'KY-2025-003', name: '可持续航空燃料适航验证研究', goal: '完成SAF适航验证方法研究', level: '公司级', channelId: 'zdcx', channelName: '重大科技创新专项', org: '试飞中心', owner: '周明', techOwner: '张晓', chiefL1: '张总师', chiefL2: '王总师', phase: '立项', risk: 'green', budgetTotal: 1200, budgetSpent: 80, budgetYear: 400, budgetYearSpent: 80, startDate: '2025-01-10', endDate: '2027-06-30', outcomeStatus: '技术储备待应用', status: '进行中', over100M: false, postEvalStatus: 'pending' },
  { id: 'p05', code: 'KY-2022-008', name: '大型客机飞控系统综合验证平台', goal: '建设飞控系统综合验证平台', level: '国家级', channelId: 'xx25', channelName: 'XX25专项', org: '上飞院', owner: '陈刚', chiefL1: '张总师', phase: '后评价', risk: 'green', budgetTotal: 12500, budgetSpent: 11800, budgetYear: 0, budgetYearSpent: 0, startDate: '2022-03-01', endDate: '2024-12-31', outcomeStatus: '已转化应用', status: '已完成', over100M: true, postEvalStatus: 'completed' },
  { id: 'p06', code: 'KY-2024-006', name: '民机噪声控制关键技术研究', goal: '降低舱内噪声3dB', level: '国家级', channelId: 'nsfc', channelName: '国家自然科学基金', org: '北研中心', owner: '马超', phase: '实施', risk: 'blue', budgetTotal: 280, budgetSpent: 120, budgetYear: 100, budgetYearSpent: 45, startDate: '2024-09-01', endDate: '2027-08-31', outcomeStatus: '技术储备待应用', status: '进行中', over100M: false, postEvalStatus: 'pending' },
  { id: 'p07', code: 'KY-2024-007', name: '上海科技创新行动计划-智能装配', goal: '智能装配工艺与装备研发', level: '地方级', channelId: 'shkj', channelName: '上海市科技创新行动计划', org: '上飞公司', owner: '黄磊', phase: '实施', risk: 'yellow', budgetTotal: 500, budgetSpent: 220, budgetYear: 200, budgetYearSpent: 95, startDate: '2024-05-01', endDate: '2026-04-30', outcomeStatus: '接续研发立项', status: '进行中', over100M: false, postEvalStatus: 'pending' },
  { id: 'p08', code: 'KY-2023-020', name: '预研三年滚动-航电系统集成验证', goal: '航电系统集成验证环境建设', level: '公司级', channelId: 'yy3n', channelName: '预研三年滚动计划', org: '试飞中心', owner: '周明', phase: '验收', risk: 'green', budgetTotal: 1800, budgetSpent: 1650, budgetYear: 300, budgetYearSpent: 280, startDate: '2023-01-01', endDate: '2025-06-30', outcomeStatus: '已转化应用', status: '已通过公司级验收', over100M: false, postEvalStatus: 'pending' },
  { id: 'p09', code: 'KY-2024-009', name: '揭榜挂帅-绿色制造技术', goal: '绿色制造工艺攻关', level: '地方级', channelId: 'shjb', channelName: '上海市科技攻关揭榜挂帅', org: '上飞公司', owner: '吴静', phase: '实施', risk: 'blue', budgetTotal: 800, budgetSpent: 350, budgetYear: 300, budgetYearSpent: 150, startDate: '2024-07-01', endDate: '2026-12-31', outcomeStatus: '技术储备待应用', status: '进行中', over100M: false, postEvalStatus: 'pending' },
  { id: 'p10', code: 'KY-2021-003', name: 'FGW高技术产业化示范工程', goal: '产业化示范与应用推广', level: '国家级', channelId: 'fgw', channelName: 'FGW GXJC项目', org: '制造公司', owner: '郑华', phase: '成果转化', risk: 'green', budgetTotal: 15000, budgetSpent: 14200, budgetYear: 0, budgetYearSpent: 0, startDate: '2021-01-01', endDate: '2024-06-30', outcomeStatus: '已转化应用', status: '已完成', over100M: true, postEvalStatus: 'completed' },
  { id: 'p11', code: 'KY-2024-011', name: '先进材料创新联盟-钛合金成形', goal: '钛合金超塑成形工艺研究', level: '公司级', channelId: 'cllm', channelName: '大飞机先进材料创新联盟', org: '材料公司', owner: '林峰', phase: '实施', risk: 'yellow', budgetTotal: 650, budgetSpent: 280, budgetYear: 250, budgetYearSpent: 110, startDate: '2024-04-01', endDate: '2026-03-31', outcomeStatus: '技术储备待应用', status: '进行中', over100M: false, postEvalStatus: 'pending' },
  { id: 'p12', code: 'KY-2024-012', name: '大飞机研究院-气动优化设计', goal: '气动优化设计方法研究', level: '公司级', channelId: 'dyjy', channelName: '大飞机研究院', org: '上飞院', owner: '何磊', phase: '实施', risk: 'blue', budgetTotal: 900, budgetSpent: 400, budgetYear: 350, budgetYearSpent: 180, startDate: '2024-02-01', endDate: '2026-01-31', outcomeStatus: '接续研发立项', status: '进行中', over100M: false, postEvalStatus: 'pending' },
  { id: 'p13', code: 'KY-2025-001', name: '气象创新中心联合研发', goal: '气象数据与飞行安全关联研究', level: '公司级', channelId: 'xjqx', channelName: '新疆大飞机气象创新中心', org: '试飞中心', owner: '周明', phase: '立项', risk: 'green', budgetTotal: 450, budgetSpent: 20, budgetYear: 200, budgetYearSpent: 20, startDate: '2025-02-01', endDate: '2027-01-31', outcomeStatus: '技术储备待应用', status: '进行中', over100M: false, postEvalStatus: 'pending' },
  { id: 'p14', code: 'KY-2023-025', name: '民机供应链数字化协同平台', goal: '供应链数字化协同平台建设', level: '公司级', channelId: 'yy3n', channelName: '预研三年滚动计划', org: '总部科技部', owner: '赵明远', phase: '协作评价', risk: 'green', budgetTotal: 2200, budgetSpent: 2100, budgetYear: 100, budgetYearSpent: 95, startDate: '2023-04-01', endDate: '2025-03-31', outcomeStatus: '已转化应用', status: '已通过公司级验收', over100M: false, postEvalStatus: 'pending' },
  { id: 'p15', code: '3-0302600-052', name: '氢电飞机验证机研制', goal: '完成氢电飞机验证机研制', level: '国家级', channelId: 'mjky', channelName: 'MJKY', initDept: '工信部', org: '北研中心', owner: '马浩博', techOwner: '李四', chiefL1: '张总师', chiefL2: '王总师', partnerUnit1: '上飞公司', partnerWork1: '机体制造', partnerUnit2: '上飞院', partnerWork2: '系统集成', phase: '实施', risk: 'yellow', budgetTotal: 8500, budgetSpent: 4200, budgetYear: 2380, budgetYearSpent: 2624, startDate: '2024-07-01', endDate: '2027-08-31', outcomeStatus: '技术储备待应用', status: '进行中', over100M: false, postEvalStatus: 'pending', mainWork: '验证机总体研制与试验' },
];

const PERSONNEL = [
  { name: '陈刚', specialty: '控制科学与工程', org: '上飞院' },
  { name: '刘洋', specialty: '动力工程及工程热物理', org: '发动机公司' },
  { name: '孙伟', specialty: '适航与安全', org: '适航审定中心' },
  { name: '周明', specialty: '材料科学与工程', org: '试飞中心' },
  { name: '马超', specialty: '力学', org: '北研中心' },
  { name: '黄磊', specialty: '机械工程', org: '上飞公司' },
  { name: '吴静', specialty: '机械工程', org: '上飞公司' },
  { name: '郑华', specialty: '机械工程', org: '制造公司' },
  { name: '林峰', specialty: '材料科学与工程', org: '材料公司' },
  { name: '何磊', specialty: '航空宇航科学与技术', org: '上飞院' },
  { name: '赵明远', specialty: '电子信息', org: '总部科技部' },
  { name: '王海涛', specialty: '管理科学与工程', org: '试飞中心' },
  { name: '张晓', specialty: '电子信息', org: '试飞中心' },
  { name: '李振华', specialty: '管理科学与工程', org: '总部' },
  { name: '陈建国', specialty: '管理科学与工程', org: '总部科技部' },
  { name: '杨帆', specialty: '控制科学与工程', org: '上飞院' },
  { name: '赵军', specialty: '控制科学与工程', org: '试飞中心' },
  { name: '钱伟', specialty: '控制科学与工程', org: '北研中心' },
  { name: '孙丽', specialty: '控制科学与工程', org: '上飞公司' },
  { name: '周杰', specialty: '控制科学与工程', org: '发动机公司' },
  { name: '吴敏', specialty: '电子信息', org: '上飞院' },
  { name: '郑浩', specialty: '电子信息', org: '北研中心' },
  { name: '王芳', specialty: '电子信息', org: '制造公司' },
  { name: '冯涛', specialty: '航空宇航科学与技术', org: '试飞中心' },
  { name: '蒋雪', specialty: '航空宇航科学与技术', org: '北研中心' },
  { name: '沈亮', specialty: '航空宇航科学与技术', org: '上飞公司' },
  { name: '韩冰', specialty: '计算机科学与技术', org: '总部科技部' },
  { name: '曹阳', specialty: '计算机科学与技术', org: '上飞院' },
  { name: '袁野', specialty: '大气科学', org: '试飞中心' },
  { name: '丁一', specialty: '数学', org: '北研中心' },
  { name: '许文', specialty: '数学', org: '上飞院' },
  { name: '高峰', specialty: '综合交叉', org: '制造公司' },
];

async function seedUsers() {
  for (const u of USERS) {
    const hash = await bcrypt.hash(u.password, 10);
    await prisma.user.upsert({
      where: { username: u.username },
      update: {
        password: hash,
        name: u.name,
        role: u.role,
        org: u.org ?? null,
        title: u.title ?? null,
        teamRole: u.teamRole ?? null,
      },
      create: { ...u, password: hash },
    });
  }
  console.log(`[seed] ${USERS.length} demo users synced`);
}

/** 供启动种子与超管手动同步调用 */
export async function syncDemoUsers() {
  await seedUsers();
  return USERS.length;
}

export async function seedDatabase() {
  await seedChannels();
  await seedUsers();

  const projectCount = await prisma.project.count();
  if (projectCount === 0) {
    for (const p of PROJECTS) {
      await prisma.project.create({ data: p });
    }

    const partners = [
      { projectId: 'p01', name: '中航工业复材', type: '参研', score: 88, level: '良好', evalStatus: '已评价', postEval: '—' },
      { projectId: 'p01', name: '北航材料学院', type: '外协', score: 92, level: '优秀', evalStatus: '已评价', postEval: '—' },
      { projectId: 'p02', name: '钢研高纳', type: '外协', score: 55, level: '不合格', evalStatus: '已评价', postEval: '—', blacklisted: true },
      { projectId: 'p03', name: '民航二所', type: '参研', score: 90, level: '优秀', evalStatus: '已评价', postEval: '进行中' },
      { projectId: 'p08', name: '上电所', type: '参研', score: 85, level: '良好', evalStatus: '已评价', postEval: '—' },
      { projectId: 'p14', name: 'SAP中国', type: '外协', score: 78, level: '合格', evalStatus: '待评价', postEval: '—' },
    ];
    for (const pt of partners) await prisma.partner.create({ data: pt });

    const outcomes = [
      { projectId: 'p03', code: 'CG-2023-001', name: '适航审定工具软件V1.0', method: '型号应用', form: '软件许可', status: '已转化应用', planDate: '2025-06-01', actualDate: '2025-03-15' },
      { projectId: 'p05', code: 'CG-2022-003', name: '飞控验证平台', method: '内部应用', form: '平台服务', status: '已转化应用', planDate: '2024-12-01', actualDate: '2024-11-20' },
      { projectId: 'p10', code: 'CG-2021-002', name: '产业化示范产线', method: '市场推广', form: '产线移交', status: '已转化应用', planDate: '2024-06-01', actualDate: '2024-05-28' },
      { projectId: 'p01', code: 'CG-2024-008', name: '复合材料工艺规范', method: '技术储备', form: '标准规范', status: '技术储备待应用', planDate: '2026-12-01' },
      { projectId: 'p07', code: 'CG-2024-005', name: '智能装配工艺包', method: '型号应用', form: '工艺文件', status: '接续研发立项', planDate: '2026-06-01' },
    ];
    for (const o of outcomes) await prisma.outcome.create({ data: o });

    const milestones = [
      { projectId: 'p01', year: 2025, title: '完成机翼段试制', dueDate: '2025-08-30', status: '进行中', risk: 'yellow' },
      { projectId: 'p02', year: 2025, title: '寿命模型验证', dueDate: '2025-06-15', status: '已超期', risk: 'red' },
      { projectId: 'p08', year: 2025, title: '系统集成测试', dueDate: '2025-05-31', status: '已完成', risk: 'green' },
      { projectId: 'p15', year: 2026, yearGoal: '完成机体制造', title: '完成高能量密度电池制造', planContent: '完成高能量密度电池制造', dueDate: '2026-06-30', status: '已完成', risk: 'green', completion: '已完成' },
      { projectId: 'p15', year: 2026, title: '完成电推进系统地面集成试验', planContent: '完成电推进系统地面集成试验', dueDate: '2026-07-31', status: '进行中', risk: 'yellow', completion: '进行中' },
      { projectId: 'p15', year: 2026, title: '完成机体制造', planContent: '完成机体制造', dueDate: '2026-12-31', status: '进行中', risk: 'green', completion: '进行中' },
    ];
    for (const m of milestones) await prisma.milestone.create({ data: m });

    const deliverables = [
      { projectId: 'p15', name: '氢电验证机专利包', type: '专利', status: '待交付', risk: 'blue' },
      { projectId: 'p15', name: '电推进试验标准', type: '标准', status: '待交付', risk: 'yellow' },
    ];
    for (const d of deliverables) await prisma.deliverable.create({ data: d });

    const todos = [
      { title: '审批：宽体客机复合材料立项变更', type: 'approval', projectId: 'p01', roles: 'mgmt_unit,project_team,mgmt_hq', orgs: '试飞中心', status: 'pending' },
      { title: '协作单位评价：供应链数字化平台', type: 'partner_eval', projectId: 'p14', roles: 'mgmt_unit,project_team', orgs: '总部科技部', status: 'pending' },
      { title: '验收材料审核：航电系统集成验证', type: 'acceptance', projectId: 'p08', roles: 'project_team,mgmt_hq', status: 'pending' },
      { title: '后评价启动：飞控系统综合验证平台', type: 'post_eval', projectId: 'p05', roles: 'mgmt_hq', status: 'pending' },
      { title: '里程碑佐证上传：噪声控制研究', type: 'milestone', projectId: 'p06', roles: 'project_team', orgs: '北研中心', status: 'pending' },
    ];
    for (const t of todos) await prisma.todo.create({ data: t });
  } else {
    console.log('[seed] projects already seeded, skip projects');
  }

  const personnelCount = await prisma.personnel.count();
  if (personnelCount === 0) {
    for (const p of PERSONNEL) await prisma.personnel.create({ data: p });
    console.log('[seed] personnel seeded');
  }

  console.log('[seed] completed');
}

import { fileURLToPath } from 'url';
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  seedDatabase().finally(() => prisma.$disconnect());
}
