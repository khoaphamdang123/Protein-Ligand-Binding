# BindSite Explorer

**Explore Protein Binding Sites with ESM-ORION**

Interactive visualization and benchmark analysis of binding-site prediction methods on TestSet300 and TestSet46.

---

## 🎯 项目状态

### ✅ Phase 1 - Angular 项目架构 (完成)
- 完整的项目结构
- 核心模型和服务
- 懒加载路由
- Mock 数据服务

### ✅ Phase 2 - 设计系统与应用框架 (完成)
- 完整的设计令牌系统
- 深色/浅色主题切换
- 响应式导航系统
- 9 个核心 UI 组件

### ✅ Phase 3 - Landing Page (完成)
- 科学可视化 Hero
- 分子结构动画
- Research Overview
- Benchmark Preview
- 完全响应式设计

### ✅ Phase 4 - Protein Explorer (完成)
- 搜索和过滤系统
- 蛋白质查看器（带控制）
- 序列查看器（5 个轨道）
- 残基选择交互
- Angular Signals 状态管理
- 完整的响应式布局

### ✅ Phase 5 - Protein Detail Page (完成)
- 6 个选项卡（Overview, Structure, Sequence, Prediction, Metrics, Comparison）
- 残基级别预测表格
- 混淆矩阵可视化
- 分数分布图
- 方法对比功能
- 完整的性能指标

### ✅ Phase 6 - Benchmark Explorer (完成)
- Benchmark Overview 页面
- TestSet300 详情页面（搜索、过滤、排序、图表）
- TestSet46 详情页面（搜索、过滤、排序、图表）
- Apache ECharts 集成（4 种交互式图表）
- 数据表格系统
- 完整的统计分析

### ✅ Phase 7 - Model Comparison (完成)
- 方法选择器（多选）
- 数据集选择器
- 性能对比表格
- 5 种交互式图表（F1 柱状图、MCC 柱状图、Precision vs Recall、雷达图、散点图）
- Quick Insights 自动计算
- Key Questions 回答系统
- Angular Signals 动态状态管理

### ✅ Phase 8 - Binding Site Methods (完成)
- 4 个预测方法卡片（ESM-ORION, FPocket, DeepSite, P2Rank）
- 类别过滤器（Protein Language Model, Geometry-Based, Deep Learning, Machine Learning）
- 方法详情模态框（Overview, Architecture, Input/Output, Benchmark Results, References）
- 搜索功能
- Benchmark 性能对比
- Mock 数据结构（预留真实数据集成）

### ✅ Phase 9 - Scientific Visualization Interaction (完成)
- ProteinInteractionService 核心服务
- selectedResidue 共享状态管理
- predictionThreshold 阈值控制（0.0-1.0）
- 动态指标计算（F1, MCC, Precision, Recall, MCC）
- TP/TN/FP/FN 状态系统（颜色+图标+文本）
- 响应式更新机制
- 隔离的计算逻辑（易于替换为后端）

### ✅ Phase 10 - Final UI/UX Polish (完成)
- 构建状态修复和验证
- 代码质量检查
- 性能分析和优化建议
- 文档完善
- 项目总结

---

## 🚀 快速开始

### 安装依赖
```bash
npm install
```

### 启动开发服务器
```bash
npm start
```

访问 http://localhost:4200

### 构建生产版本
```bash
npm run build
```

---

## 🎨 设计系统

### 颜色
- **背景**: #0B1020 (主背景), #111827 (面板)
- **主色调**: #38BDF8 (科学蓝)
- **成功色**: #34D399 (科学绿)
- **文本**: #E5E7EB (主), #94A3B8 (次)

### 排版
- **主字体**: Inter (Sans-serif)
- **等宽字体**: JetBrains Mono
- **字号范围**: 12px - 36px

### 组件
- Button, Badge, Card, Panel
- Tabs, Tooltip, DataTable
- SectionHeader, MetricCard
- ProteinViewer, SequenceViewer

---

## 📁 项目结构

```
src/app/
├── core/                    # 核心服务和模型
│   ├── models/             # 数据模型
│   ├── services/           # 服务（Theme, MockData）
│   ├── state/              # 状态管理（Protein, Explorer）
│   └── utils/              # 工具函数
├── shared/                  # 共享组件和工具
│   ├── ui/                 # UI 组件库
│   ├── components/         # 通用组件
│   ├── directives/         # 指令
│   └── pipes/              # 管道
├── layout/                  # 布局组件
│   ├── navbar/             # 导航栏
│   ├── sidebar/            # 侧边栏
│   └── app-shell/          # 应用外壳
├── features/                # 功能页面
│   ├── home/               # 主页 ✅
│   ├── explorer/           # 蛋白质浏览器 ✅
│   ├── protein-detail/     # 蛋白质详情 ✅
│   ├── benchmark/          # 基准测试
│   ├── comparison/         # 方法对比
│   ├── methods/            # 方法详情
│   └── about/              # 关于页面
├── molecular/               # 分子可视化组件
│   ├── protein-viewer/     # 3D 蛋白质查看器 ✅
│   ├── sequence-viewer/    # 序列查看器 ✅
│   ├── residue-viewer/     # 残基查看器
│   └── viewer-controls/    # 查看器控制
└── visualization/           # 数据可视化组件
    ├── charts/             # 图表组件
    ├── confusion-matrix/   # 混淆矩阵
    ├── score-distribution/ # 分数分布
    └── metric-comparison/  # 指标对比
```

---

## 🔧 技术栈

- **Angular**: 22 (Standalone Components)
- **TypeScript**: 严格模式
- **SCSS**: CSS Variables
- **Angular Signals**: 状态管理
- **Angular Router**: 懒加载
- **响应式设计**: Mobile-first

---

## 📄 数据集

### TestSet300
- **Proteins**: 300
- **Binding Residues**: 12,450
- **Avg. Sequence Length**: 342
- **Evaluated Methods**: 4

### TestSet46
- **Proteins**: 46
- **Binding Residues**: 1,876
- **Avg. Sequence Length**: 385
- **Evaluated Methods**: 4

---

## 🔍 预测方法

1. **ESM-ORION** - 基于 ESM 的结合位点预测
2. **FPocket** - 基于几何的口袋检测
3. **DeepSite** - 深度学习方法
4. **P2Rank** - 机器学习方法

---

## 📊 功能特性

### ✅ 已实现
- ✅ 科学可视化 Landing Page
- ✅ 深色/浅色主题切换
- ✅ 响应式导航系统
- ✅ 完整的 UI 组件库
- ✅ Protein Explorer 页面
  - 搜索和过滤
  - 蛋白质查看器
  - 序列查看器（5 轨道）
  - 残基选择交互
  - 性能指标显示
- ✅ Protein Detail 页面
  - 6 个选项卡导航
  - Overview（指标卡片）
  - Structure（3D 查看器）
  - Sequence（序列查看）
  - Prediction（残基表格）
  - Metrics（混淆矩阵 + 分布图）
  - Comparison（方法对比）
- ✅ Benchmark Explorer 页面
  - Benchmark Overview
  - TestSet300（搜索、过滤、表格、图表）
  - TestSet46（搜索、过滤、表格、图表）
  - 4 种交互式图表（ECharts）
- ✅ Model Comparison 页面
  - 方法多选和数据切换
  - 5 种可视化图表（F1/MCC 柱状图、Precision vs Recall、雷达图、散点图）
  - Quick Insights 和 Key Questions
  - 实时动态更新
- ✅ Methods 页面
  - 4 个预测方法详情
  - 方法分类和搜索
  - 模态框详细信息
  - Benchmark 性能对比

### 🚧 开发中
- 🔲 真实数据 API 集成
- 🔲 3D 分子查看器（Mol*/NGL/3Dmol.js）
- 🔲 完整的交互服务集成
- 🔲 无障碍功能完善

---

## 🎯 路由结构

```
/                           # Landing Page ✅
/explore                    # 蛋白质浏览器 ✅
/protein/:id                # 蛋白质详情 ✅
/benchmark                  # 基准测试列表 ✅
/benchmark/testset300       # TestSet300 详情 ✅
/benchmark/testset46        # TestSet46 详情 ✅
/compare                    # 方法对比
/methods                    # 方法详情
/about                      # 关于页面
```

---

## 📝 页面使用指南

### Landing Page (/)
- 查看项目介绍
- 了解数据集信息
- 快速导航到功能页面

### Explorer Page (/explore)
1. 搜索蛋白质（ID 或 PDB ID）
2. 使用过滤器（数据集、方法、类型）
3. 查看蛋白质可视化
4. 浏览序列和预测
5. 点击残基查看详情

### Protein Detail Page (/protein/:id)
**6 个选项卡功能：**

1. **Overview** - 快速查看性能指标
   - F1 Score, MCC, Precision, Recall
   - 结合残基统计

2. **Structure** - 3D 蛋白质结构
   - 控制面板
   - 残基高亮

3. **Sequence** - 序列详细视图
   - 5 个信息轨道
   - 缩放控制
   - 残基交互

4. **Prediction** - 残基级别预测
   - 完整数据表格
   - TP/TN/FP/FN 状态
   - 可排序列

5. **Metrics** - 统计可视化
   - 混淆矩阵
   - 分数分布图
   - 附加指标

6. **Comparison** - 方法对比
   - 多方法性能对比
   - 表格展示

---

## 🔄 状态管理（Angular Signals）

### ExplorerState
```typescript
// 当前状态
currentProtein: Signal<Protein | null>
currentPrediction: Signal<PredictionResult | null>
selectedResidue: Signal<Residue | null>
filters: Signal<ExplorerFilters>

// 计算属性
sequence: computed(() => ...)
residues: computed(() => ...)

// 操作方法
setCurrentProtein(protein)
selectResidueByPosition(position)
updateFilters(filters)
```

---

## 📝 开发说明

### 设计原则
- 科学工作站美学
- 高信息密度但保持清晰
- 专业且现代
- 避免过度圆润和渐变

### 代码规范
- 使用 Angular Standalone Components
- 使用 Angular Signals 进行状态管理
- 遵循 Angular 最佳实践
- 使用 TypeScript 严格模式

### 响应式断点
- **移动端**: < 640px
- **平板**: 640px - 1024px
- **桌面**: > 1024px

---

## 🔄 后续计划

### 短期优化（1-2 周）
1. CSS 文件大小优化
2. Bundle 大小优化
3. 无障碍功能增强

### 中期开发（1-2 月）
1. 真实数据 API 集成
2. 3D 分子查看器集成
3. 交互服务完整集成
4. 性能优化

### 长期规划（3-6 月）
1. 用户账户系统
2. 高级分析工具
3. 数据导出功能
4. 协作功能

---

## 📜 许可证

本项目仅用于研究和教育目的。

---

**当前版本**: Phase 10 完成  
**最后更新**: 2026-09-01  
**开发服务器**: http://localhost:4200  
**构建状态**: ✅ 成功  

**核心页面**: 
- Landing: http://localhost:4200
- Explorer: http://localhost:4200/explore  
- Detail: http://localhost:4200/protein/:id
- Benchmark: http://localhost:4200/benchmark
- TestSet300: http://localhost:4200/benchmark/testset300
- TestSet46: http://localhost:4200/benchmark/testset46
- Compare: http://localhost:4200/compare
- Methods: http://localhost:4200/methods
