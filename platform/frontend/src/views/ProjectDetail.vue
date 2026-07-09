<script setup>
import { ref, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import api from '../api';
import ChannelFlowTimeline from '../components/ChannelFlowTimeline.vue';

const route = useRoute();
const router = useRouter();
const project = ref(null);
const flowSaving = ref(false);

async function loadProject() {
  const { data } = await api.get(`/projects/${route.params.id}`);
  project.value = data;
}

onMounted(loadProject);

const riskLabel = { red: '红', yellow: '黄', blue: '蓝', green: '绿' };

async function setFlowStep(step) {
  if (!project.value?.canEdit) return;
  flowSaving.value = true;
  try {
    const { data } = await api.patch(`/projects/${project.value.id}/flow-step`, { step });
    project.value = { ...project.value, ...data, canEdit: project.value.canEdit };
  } finally {
    flowSaving.value = false;
  }
}
</script>

<template>
  <div v-if="project">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
      <el-button @click="router.back()">← 返回</el-button>
      <h2 class="page-title" style="margin:0">{{ project.name }}</h2>
      <span class="risk-dot" :class="project.risk" />
      <el-tag size="small">{{ riskLabel[project.risk] || project.risk }}预警</el-tag>
    </div>
    <p class="muted">{{ project.code }} · {{ project.level }} · {{ project.channelName }} · {{ project.org }}</p>

    <section v-if="project.channelFlow?.nodes?.length" class="flow-section">
      <div class="flow-section__head">
        <div>
          <h3>渠道全周期管理流程</h3>
          <p class="muted">
            {{ project.channelFlow.level }} · {{ project.channelFlow.dept }} · {{ project.channelName }}
            · 当前节点：{{ project.channelFlow.currentStepName }}
          </p>
        </div>
        <div v-if="project.canEdit" class="flow-actions">
          <el-button
            size="small"
            :disabled="flowSaving || project.channelFlow.currentStep <= 0"
            @click="setFlowStep(project.channelFlow.currentStep - 1)"
          >
            上一节点
          </el-button>
          <el-button
            size="small"
            type="primary"
            plain
            :disabled="flowSaving || project.channelFlow.currentStep >= project.channelFlow.steps.length - 1"
            @click="setFlowStep(project.channelFlow.currentStep + 1)"
          >
            推进至下一节点
          </el-button>
        </div>
      </div>
      <ChannelFlowTimeline :nodes="project.channelFlow.nodes" />
    </section>

    <el-card shadow="never" style="margin-bottom:16px">
      <template #header>项目所属信息 <small class="muted">（V18 台账表头）</small></template>
      <el-descriptions :column="2" border size="small">
        <el-descriptions-item label="项目编号">{{ project.code }}</el-descriptions-item>
        <el-descriptions-item label="名称">{{ project.name }}</el-descriptions-item>
        <el-descriptions-item label="目标" :span="2">{{ project.goal }}</el-descriptions-item>
        <el-descriptions-item label="开始时间">{{ project.startDate }}</el-descriptions-item>
        <el-descriptions-item label="结束时间">{{ project.endDate }}</el-descriptions-item>
        <el-descriptions-item label="层级">{{ project.level }}</el-descriptions-item>
        <el-descriptions-item label="立项部门">{{ project.initDept || '—' }}</el-descriptions-item>
        <el-descriptions-item label="渠道类别">{{ project.channelName }}</el-descriptions-item>
        <el-descriptions-item label="牵头单位">{{ project.org }}</el-descriptions-item>
        <el-descriptions-item label="项目状态">{{ project.status }}</el-descriptions-item>
        <el-descriptions-item label="成果转化状态">{{ project.outcomeStatus }}</el-descriptions-item>
        <el-descriptions-item label="预警">{{ riskLabel[project.risk] || project.risk }}</el-descriptions-item>
        <el-descriptions-item label="主要工作内容" :span="2">{{ project.mainWork || '—' }}</el-descriptions-item>
        <el-descriptions-item label="参研单位 1">{{ project.partnerUnit1 || '—' }}</el-descriptions-item>
        <el-descriptions-item label="主要工作内容 1">{{ project.partnerWork1 || '—' }}</el-descriptions-item>
        <el-descriptions-item label="参研单位 2">{{ project.partnerUnit2 || '—' }}</el-descriptions-item>
        <el-descriptions-item label="主要工作内容 2">{{ project.partnerWork2 || '—' }}</el-descriptions-item>
        <el-descriptions-item label="预留参研单位" :span="2">{{ project.partnerUnitsExtra || '—' }}</el-descriptions-item>
      </el-descriptions>
    </el-card>

    <el-card shadow="never" style="margin-bottom:16px">
      <template #header>人员团队</template>
      <el-descriptions :column="3" border size="small">
        <el-descriptions-item label="项目负责人">{{ project.owner }}</el-descriptions-item>
        <el-descriptions-item label="技术负责人">{{ project.techOwner || '—' }}</el-descriptions-item>
        <el-descriptions-item label="项目主管">{{ project.pmName || '—' }}</el-descriptions-item>
        <el-descriptions-item label="一级总师">{{ project.chiefL1 || '—' }}</el-descriptions-item>
        <el-descriptions-item label="二级总师">{{ project.chiefL2 || '—' }}</el-descriptions-item>
        <el-descriptions-item label="总部处室处长">{{ project.mgmtHqDirector || '—' }}</el-descriptions-item>
        <el-descriptions-item label="总部处室主管">{{ project.mgmtHqSupervisor || '—' }}</el-descriptions-item>
        <el-descriptions-item label="单位科技部长">{{ project.mgmtUnitMinister || '—' }}</el-descriptions-item>
        <el-descriptions-item label="单位科技主管">{{ project.mgmtUnitSupervisor || '—' }}</el-descriptions-item>
        <el-descriptions-item label="总部财务主管">{{ project.financeHq || '—' }}</el-descriptions-item>
        <el-descriptions-item label="单位财务部长">{{ project.financeUnitMinister || '—' }}</el-descriptions-item>
        <el-descriptions-item label="单位财务主管">{{ project.financeUnitSupervisor || '—' }}</el-descriptions-item>
      </el-descriptions>
    </el-card>

    <el-row :gutter="16">
      <el-col :span="12">
        <el-card shadow="never">
          <template #header>科研经费 <small class="muted">（汇总观察口径）</small></template>
          <el-descriptions :column="2" border size="small">
            <el-descriptions-item label="总经费">{{ project.budgetTotal }} 万</el-descriptions-item>
            <el-descriptions-item label="历年支出">{{ project.budgetSpent }} 万</el-descriptions-item>
            <el-descriptions-item label="年度预算">{{ project.budgetYear }} 万</el-descriptions-item>
            <el-descriptions-item label="年度支出">{{ project.budgetYearSpent }} 万</el-descriptions-item>
          </el-descriptions>
        </el-card>
        <el-card shadow="never" style="margin-top:12px">
          <template #header>后评价</template>
          <p v-if="!project.over100M" class="muted">不适用（未超1亿）</p>
          <p v-else>{{ project.postEvalStatus }}</p>
        </el-card>
      </el-col>
      <el-col :span="12">
        <el-card shadow="never">
          <template #header>科研年度目标及计划</template>
          <el-table :data="project.milestones" size="small">
            <el-table-column prop="yearGoal" label="年度目标" show-overflow-tooltip />
            <el-table-column prop="planContent" label="计划内容" show-overflow-tooltip />
            <el-table-column prop="dueDate" label="完成时间" width="100" />
            <el-table-column prop="completion" label="完成情况" width="90" />
            <el-table-column prop="planStatus" label="计划状态" width="80" />
          </el-table>
        </el-card>
      </el-col>
    </el-row>

    <el-row :gutter="16" style="margin-top:12px">
      <el-col :span="12">
        <el-card shadow="never">
          <template #header>交付物</template>
          <el-table :data="project.deliverables" size="small">
            <el-table-column prop="name" label="名称" />
            <el-table-column prop="type" label="类型" width="70" />
            <el-table-column prop="status" label="状态" width="80" />
            <el-table-column prop="ownership" label="权属" width="80" />
            <el-table-column prop="outcomeCode" label="成果编号" width="90" />
          </el-table>
        </el-card>
      </el-col>
      <el-col :span="12">
        <el-card shadow="never">
          <template #header>协作单位评价</template>
          <el-table :data="project.partners" size="small">
            <el-table-column prop="name" label="单位" />
            <el-table-column prop="type" label="类型" width="60" />
            <el-table-column prop="evaluator" label="评价人" width="80" />
            <el-table-column prop="score" label="得分" width="50" />
            <el-table-column prop="level" label="等级" width="60" />
          </el-table>
        </el-card>
      </el-col>
    </el-row>

    <el-card v-if="project.outcomes?.length" shadow="never" style="margin-top:12px">
      <template #header>成果转化</template>
      <el-table :data="project.outcomes" size="small">
        <el-table-column prop="code" label="成果编号" width="110" />
        <el-table-column prop="name" label="成果名称" />
        <el-table-column prop="method" label="转化方式" width="90" />
        <el-table-column prop="form" label="转化形式" width="90" />
        <el-table-column prop="status" label="转化状态" width="110" />
      </el-table>
    </el-card>

    <el-card v-if="project.files?.length" shadow="never" style="margin-top:12px">
      <template #header>项目材料文件夹 <small class="muted">（{{ project.files.length }} 个文件）</small></template>
      <el-table :data="project.files" size="small" max-height="280">
        <el-table-column prop="folderName" label="文件夹" width="120" />
        <el-table-column prop="relativePath" label="路径" show-overflow-tooltip />
        <el-table-column prop="size" label="大小" width="90">
          <template #default="{ row }">{{ (row.size / 1024).toFixed(1) }} KB</template>
        </el-table-column>
        <el-table-column prop="uploadedBy" label="上传人" width="90" />
      </el-table>
    </el-card>

    <el-card shadow="never" style="margin-top:16px">
      <template #header>操作留痕</template>
      <el-timeline>
        <el-timeline-item v-for="a in project.audits" :key="a.id" :timestamp="new Date(a.createdAt).toLocaleString()">
          {{ a.actor }} · {{ a.action }} — {{ a.detail }}
        </el-timeline-item>
        <el-timeline-item v-if="!project.audits?.length" timestamp="系统">暂无留痕记录</el-timeline-item>
      </el-timeline>
    </el-card>
  </div>
</template>

<style scoped>
.flow-section {
  margin: 16px 0;
  padding: 16px;
  background: #0c1220;
  border: 1px solid rgba(70, 130, 180, 0.18);
  border-left: 3px solid #4682B4;
  border-radius: 4px;
}
.flow-section__head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  margin-bottom: 8px;
}
.flow-section__head h3 { margin: 0 0 4px; font-size: 14px; color: #f1f5f9; }
.flow-section__head p { margin: 0; font-size: 12px; }
.flow-actions { display: flex; gap: 8px; flex-shrink: 0; }
</style>
