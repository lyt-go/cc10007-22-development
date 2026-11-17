# 智能运营决策分析平台

面向用户行为序列分析、RFM分层、流失预警、智能推荐、归因建模、活动效果评估与实时运营决策的数据分析工程平台。

这是一个前后端分离的管理平台：前端 React + Vite + TypeScript，后端 FastAPI（Python）。
两边各自独立启动，前端 dev server 已关掉自动打开页面，启动后按终端打印的地址手工打开。

## 目录结构

```text
.
├── frontend/                 React + Vite + TypeScript 前端
│   ├── src/views/            每个业务模块一个页面
│   ├── src/api/              统一请求封装
│   ├── src/stores/           会话与筛选状态
│   └── vite.config.ts        dev server 配置（open: false）
├── backend/                  FastAPI（Python） 后端
│   ├── app/routers/          每个业务模块一组接口
│   ├── app/services/         业务规则与状态流转
│   └── app/store.py          内存数据仓库与示例数据
├── .gitignore
└── docker-compose.yml
```

## 启动

### 后端

```bash
cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
./run.sh
```

健康检查：`curl http://127.0.0.1:8000/api/health`

### 前端

```bash
cd frontend
npm install
npm run dev
```

前端默认监听 `http://127.0.0.1:5173/`，dev server 不会自动打开浏览器，
需要自己访问。`/api` 由 vite 代理到后端 `http://127.0.0.1:8000`。

## 业务模块

| 模块 | 目录 | 业务对象 | 主要字段 |
| --- | --- | --- | --- |
| 行为序列 | `sequence` | 序列模式 | 模式编号、用户分群、事件序列 |
| RFM分层 | `rfm` | 分层规则 | 规则编号、最近消费天界、消费频次界 |
| 流失预警 | `churn` | 预警模型 | 模型编号、模型名称、特征变量 |
| 智能推荐 | `recommend` | 推荐策略 | 策略编号、推荐场景、召回算法 |
| 归因建模 | `attrmodel` | 归因模型 | 模型编号、模型名称、归因逻辑 |
| 活动评估 | `activity` | 活动方案 | 方案编号、活动名称、活动类型 |
| 实时决策 | `realtime` | 决策规则 | 规则编号、触发事件、决策条件 |
| 预算分配 | `budget` | 预算方案 | 方案编号、预算总额、渠道分配比例 |
| LTV估算 | `lifetime` | LTV模型 | 模型编号、模型名称、估算方法 |
| 实验变体 | `abvariant` | 变体方案 | 变体编号、关联实验、变体名称 |
| 变体分流记录 | `absplit` | 分流记录（新增入口） | 分流记录编号、关联实验、变体编号、来源标识、分流占比、指标窗口、指标组合 |
| 看板指标明细 | `abmetric` | 实验看板指标明细数据集 | 版本号、批次号、行类型、变体状态、指标组合、指标差异、告警线状态 |
| 运营看板 | `dashboard` | 看板视图 | 视图编号、视图名称、指标组合、指标数据版本、发布准入、告警线状态 |
| 评分卡 | `scorecard` | 评分卡 | 评分编号、评分对象、特征变量组 |
| 聚类分群 | `cluster` | 聚类任务 | 任务编号、聚类算法、特征维度 |
| 对比分析 | `comparison` | 对比组 | 对比编号、对比名称、实验组筛选 |
| 数据漂移 | `datadrift` | 漂移检测 | 检测编号、监控数据集、基线版本 |
| 推送计划 | `pushplan` | 推送方案 | 方案编号、推送内容、目标人群 |
| 指标归因 | `metricdrill` | 归因分析 | 分析编号、目标指标、波动方向 |
| 策略库 | `tacticlib` | 运营策略 | 策略编号、策略名称、策略类型 |

## 约定

- 每个模块的前端页面在 `frontend/src/views/<模块>/index.vue`，后端接口在
  `backend/app/routers/<模块>.py`，业务规则在 `backend/app/services/<模块>.py`。
- 列表接口统一返回 `{ items, total, page, size }`，动作接口统一返回 `{ ok, message }`。
- 状态流转只允许在 `app/services` 里改，路由层不做业务判断。

## 实验变体到运营看板的发布准入

跨模块链路（DASH-0002 为核对基准视图）：

1. 新增模块入口把变体分流记录登记到 `absplit`（待核对，带来源标识，凭来源映射对照）；
2. `POST /api/abmetric/generate` 按看板视图「指标组合」的字段范围读取分流记录，
   **只有已生效变体**才能进入数据集，未生效记录整单剔除并在版本流水留痕；
3. 同一实验的多个已生效变体在同一指标窗口产生多组指标时，按分流占比加权合并为
   唯一一套当前指标组合，变体级明细与指标差异仍逐行保留；变体状态与指标组合在
   同一批次（版本号+批次号）提交；
4. `POST /api/abmetric/{版本}/settle` 整批落定后，`/api/abmetric/check` 并发核对
   才采用该版本，待落定版本对核对不可见；
5. `POST /api/abmetric/{版本}/publish` 发布后回写看板视图的数据版本、发布准入、
   告警线状态，并按订阅接收组生成订阅告警通知（`abnotify`），看板视图可通过
   `GET /api/dashboard/{id}/metrics` 按版本回溯明细。

领域：数据工程
子方向：数据分析与数据应用
