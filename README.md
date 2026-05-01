# Water Twin System

面向水利场景的点云语义分割、三维可视化、巡检风险评估、防洪预警辅助、堤坝岸坡隐患排查、自动报告导出与 AI 风险问答系统。

本项目以带标签点云为核心输入，围绕“上传点云 -> 语义分割 -> 原始标签与预测结果对比 -> 分类统计 -> 风险区域定位 -> 巡检/防洪/堤坝分析 -> 报告导出 -> AI 问答”构建了一条完整的业务闭环，适合作为水利数字孪生、智慧巡检、课程设计、毕业设计或功能原型系统。

## 目录

- [1. 项目定位](#1-项目定位)
- [2. 核心能力总览](#2-核心能力总览)
- [3. 页面与功能说明](#3-页面与功能说明)
- [4. 技术架构](#4-技术架构)
- [5. 项目目录结构](#5-项目目录结构)
- [6. 数据格式与标签体系](#6-数据格式与标签体系)
- [7. 点云分析流程](#7-点云分析流程)
- [8. 巡检风险评估逻辑](#8-巡检风险评估逻辑)
- [9. 空间风险区域定位逻辑](#9-空间风险区域定位逻辑)
- [10. 防洪预警逻辑](#10-防洪预警逻辑)
- [11. 堤坝岸坡隐患排查逻辑](#11-堤坝岸坡隐患排查逻辑)
- [12. 报告与导出逻辑](#12-报告与导出逻辑)
- [13. AI 助手逻辑](#13-ai-助手逻辑)
- [14. 用户认证与安全策略](#14-用户认证与安全策略)
- [15. 前端状态记忆与缓存机制](#15-前端状态记忆与缓存机制)
- [16. 后端 API 清单](#16-后端-api-清单)
- [17. 环境准备与启动方式](#17-环境准备与启动方式)
- [18. PointNet 模型目录配置](#18-pointnet-模型目录配置)
- [19. 数据库说明](#19-数据库说明)
- [20. AI 配置文件说明](#20-ai-配置文件说明)
- [21. 适合扩展的实际应用方向](#21-适合扩展的实际应用方向)
- [22. 当前实现边界与注意事项](#22-当前实现边界与注意事项)

## 1. 项目定位

这个项目不是一个单纯的点云分割 Demo，而是一个偏业务化的水利数字孪生分析系统。它具备以下特点：

- 既能做点云语义分割，也能做原始标签与预测结果的对比可视化。
- 既能输出统计结果，也能进一步做巡检风险判定、防洪辅助评估和堤坝岸坡隐患排查。
- 既有传统规则引擎，也有接入大模型后的 AI 风险问答能力。
- 既有用户登录注册体系，也有管理员账号安全中心、审计日志、账号冻结/解锁/删改等安全治理能力。

## 2. 核心能力总览

- 点云上传与解析：支持 `.pth` 和 `.npy`。
- PointNet 语义分割推理：后端通过统一模型接口加载外部 PointNet 模型。
- 原始标签可视化：如果原始点云第 7 列带 `label_id`，可按原始标签进行语义着色和业务着色。
- 预测结果可视化：支持按语义类别和业务类别着色。
- 单视图/对比视图切换：支持原始标签与预测结果的同步对比。
- 类别高亮筛选：支持语义类别和业务类别多选高亮。
- 仅显示选中类别：未选中点可不参与绘制。
- 分类统计：统计语义类别占比、业务大类占比。
- 风险区域定位：从风险评分结果中提取空间区域，定位并叠加显著标记。
- 隐患图册导出：自动遍历风险区域并导出图册 HTML。
- 自动巡检报告：支持 PDF、Word、TXT/文本导出链路。
- 防洪预警辅助：融合点云分析结果与人工输入水情参数。
- 堤坝岸坡排查：基于统一风险引擎输出专门的堤坝/岸坡风险结果。
- AI 助手：基于当前分析结果进行中文问答、流式输出、Markdown 渲染、历史会话管理与本地缓存。
- 认证与安全：登录、注册、修改密码、记住我、账号冻结、锁定、审计日志、管理员安全中心。

## 3. 页面与功能说明

### 3.1 `index.html` 项目总览

- 展示系统定位、能力概览、功能流程。
- 读取最近一次任务状态，显示最近分析的文件和分割状态。

### 3.2 `viewer.html` 点云分析

这是整个系统的主工作台。

主要功能：

- 上传点云文件。
- 执行语义分割。
- 在三维视口查看点云。
- 支持以下模式切换：
  - `原始点云`
  - `语义着色`
  - `业务着色`
- 支持以下查看方式：
  - `普通查看`
  - `对比查看`
- 对比模式下：
  - 左侧优先显示原始标签结果
  - 右侧显示预测结果
  - 相机控制联动同步
- 支持点数限制。
- 支持类别高亮、多选筛选、仅显示选中类别。
- 支持风险区域定位、截图导出、隐患图册导出。

### 3.3 `report.html` 统计与导出

- 展示当前任务的语义类别统计。
- 展示当前任务的业务类别统计。
- 只展示点数大于 0 的类别。
- 显示语义类别数、业务类别数、总点数、任务状态。
- 提供导出按钮：
  - 导出 JSON
  - 导出 CSV
  - 巡检报告 PDF
  - 巡检报告 Word

### 3.4 `inspection.html` 巡检提示

- 展示统一风险引擎生成的巡检结果。
- 展示总体风险等级、总体分数。
- 展示高等级告警数量、中低等级告警数量。
- 展示每条告警的：
  - 风险标题
  - 风险等级
  - 风险分数
  - 原因解释
  - 指标值
  - 关联点数
  - 巡检建议

### 3.5 `flood.html` 防洪预警

- 接收人工输入：
  - 当前水位
  - 警戒水位
  - 24h 降雨量
  - 未来 6h 预报降雨量
  - 排水状态
- 调用后端接口统一计算最终防洪分数。
- 输出预警等级、分数、风险来源、处置建议。

### 3.6 `embankment.html` 堤坝岸坡隐患排查

- 直接调用后端堤坝岸坡风险接口。
- 展示堤体、边坡、陡坎、裸地、水边线、暴露目标等指标。
- 输出风险等级、风险摘要、形成依据和排查建议。

### 3.7 `ai.html` AI 助手

- 基于当前任务的分析结果向大模型提问。
- 支持预设问题：
  - 哪里最危险
  - 为什么危险
  - 建议先检查什么
  - 给我一个整体巡检总结
- 支持自由输入问题。
- 支持流式输出。
- 支持 Markdown 渲染。
- 支持回答缓存。
- 支持历史会话列表。
- 支持新建会话、删除会话、重命名会话。
- 支持复制回答、重新生成、导出 Markdown。
- 历史会话栏可折叠，折叠后主对话区自动扩展。

### 3.8 `login.html` / `register.html` / `change-password.html`

- 登录页支持：
  - 用户名密码登录
  - 记住我
  - 注册入口
- 注册页支持普通用户注册。
- 修改密码页支持当前已登录用户修改密码。

### 3.9 `security.html` 管理员账号安全中心

仅管理员可访问。

主要功能：

- 查看系统用户总数、管理员数、冻结账号数、异常事件数。
- 新增用户。
- 指定用户为普通用户或管理员。
- 冻结/解冻用户。
- 解锁用户。
- 重置用户密码。
- 删除用户。
- 清空指定用户审计日志。
- 清空全部审计日志。
- 查看最近 50 条安全事件。
- 审计日志支持筛选：
  - 按用户名
  - 按事件类型
  - 按风险等级

## 4. 技术架构

### 4.1 后端

- FastAPI
- Uvicorn
- NumPy
- PyTorch
- SQLite

### 4.2 前端

- HTML
- CSS
- JavaScript
- Three.js

### 4.3 模型

- 外部 PointNet 语义分割模型
- 通过统一模型接口封装在 `backend/app/core/model_interface.py`

### 4.4 数据流

1. 前端上传点云文件到后端。
2. 后端缓存原始点云数据到内存 `_cache`。
3. 执行 PointNet 推理后，将预测标签写回 `_cache`。
4. 基于标签生成统计、风险、巡检、导出、AI 问答上下文。
5. 前端通过 `TaskState` 记忆当前任务和页面状态。

## 5. 项目目录结构

```text
water_twin_system/
├─ backend/
│  ├─ app/
│  │  ├─ api/
│  │  │  └─ routes.py
│  │  ├─ core/
│  │  │  ├─ model_interface.py
│  │  │  └─ pointcloud_loader.py
│  │  ├─ services/
│  │  │  ├─ analysis.py
│  │  │  └─ ai_assistant.py
│  │  ├─ utils/
│  │  │  └─ export.py
│  │  ├─ auth.py
│  │  ├─ config.py
│  │  └─ main.py
│  ├─ config/
│  │  ├─ ai_settings.example.json
│  │  └─ ai_settings.json
│  ├─ data/
│  │  ├─ auth.db
│  │  ├─ raw/
│  │  ├─ processed/
│  │  └─ results/
│  └─ requirements.txt
├─ frontend/
│  ├─ css/
│  │  └─ style.css
│  ├─ js/
│  │  ├─ app.js
│  │  ├─ auth.js
│  │  ├─ report.js
│  │  ├─ inspection.js
│  │  ├─ flood.js
│  │  ├─ embankment.js
│  │  ├─ ai-assistant.js
│  │  ├─ security.js
│  │  ├─ overview.js
│  │  └─ shared-state.js
│  ├─ index.html
│  ├─ viewer.html
│  ├─ report.html
│  ├─ inspection.html
│  ├─ flood.html
│  ├─ embankment.html
│  ├─ ai.html
│  ├─ security.html
│  ├─ login.html
│  ├─ register.html
│  └─ change-password.html
├─ tests/
├─ run.py
└─ README.md
```

## 6. 数据格式与标签体系

### 6.1 点云输入格式

项目面向 `(N, >=6)` 的二维数组。

最推荐格式：

```text
x, y, z, r, g, b, label_id
```

字段说明：

- `x, y, z`：三维坐标
- `r, g, b`：颜色
- `label_id`：原始语义标签，可用于原始标签可视化与对比

如果没有第 7 列原始标签：

- 仍然可以执行模型预测
- 但原始标签对比和原始语义着色功能会受限

### 6.2 支持的语义类别

系统使用 15 类标签：

| ID | 英文名 | 中文名 |
|---|---|---|
| 0 | Shed | 棚屋 |
| 1 | Concretehouse | 居民地 |
| 2 | Cementroad | 水泥路 |
| 3 | Dirtroad | 土路 |
| 4 | Slope | 边坡 |
| 5 | Scarp | 陡坎 |
| 6 | Dam | 堤坝 |
| 7 | Vegetablefield | 菜地 |
| 8 | Grassland | 草地 |
| 9 | Dryland | 旱地 |
| 10 | Woodland | 林地 |
| 11 | Bareland | 裸地 |
| 12 | Waterline | 水边线 |
| 13 | Ditch | 沟渠 |
| 14 | Others | 其他 |

### 6.3 业务大类映射

在 `backend/app/config.py` 中定义：

- 居民地设施：`[0, 1]`
- 交通：`[2, 3]`
- 水系：`[6, 12, 13]`
- 地形：`[4, 5, 11]`
- 植被农田：`[7, 8, 9, 10]`
- 其他：`[14]`

### 6.4 颜色体系

- 语义类别颜色由 `CLASS_COLORS` 定义
- 业务类别颜色由前端 `businessPalette` 与后端业务颜色映射共同维护

## 7. 点云分析流程

### 7.1 上传阶段

接口：`POST /api/upload`

后端逻辑：

- 检查扩展名是否为 `.pth` 或 `.npy`
- 为文件生成 `file_id`
- 保存到 `backend/data/raw/`
- 读取点云内容并存入内存 `_cache[file_id]`
- 返回点数、包围盒、是否带标签等信息

### 7.2 预处理阶段

在 `pointcloud_loader.py` 中完成：

- 读取原始点云
- 拆分出 `xyz` 与 `rgb`
- 使用滑窗方式切块
- 生成 PointNet 需要的 9 维特征：
  - centered xyz
  - normalized rgb
  - normalized xyz

### 7.3 推理阶段

在 `model_interface.py` 中完成：

- 从 `POINTNET_DIR/models` 动态导入 `pointnet_sem_seg`
- 加载 `best_model.pth`
- 使用投票池 `vote_pool` 对多块预测结果做融合
- 最终输出每个点的语义类别 ID

### 7.4 可视化阶段

前端 `app.js` 负责：

- 调用 `/api/pointcloud/{file_id}`
- 请求不同模式下的颜色数据
- 使用 Three.js 构建点云几何体
- 记录原始中心点 `rawCenter`
- 支持普通视图和对比视图

### 7.5 模式说明

- `original`
  - 使用原始 RGB 颜色显示
  - 在对比模式下也可指定标签来源
- `semantic`
  - 使用语义类别颜色显示
  - 可选择 `raw` 或 `pred` 作为标签来源
- `business`
  - 使用业务类别颜色显示
  - 可选择 `raw` 或 `pred` 作为标签来源

### 7.6 高亮筛选逻辑

前端支持两种筛选模式：

- `dim`
  - 未选中点仍绘制，但颜色变暗
- `hide`
  - 未选中点不参与绘制，点云几何会重建为子集

支持以下选择方式：

- 只选语义类别
- 只选业务类别
- 同时选语义类别与业务类别
- 两者组合时为交集逻辑

### 7.7 点云页面状态记忆

点云分析页会记住：

- 当前文件 ID
- 文件名
- 文件基础信息
- 是否已分割
- 当前显示模式
- 当前查看模式
- 点数限制
- 分类统计
- 巡检结果
- 防洪页面状态
- 堤坝页面状态
- 高亮筛选状态

## 8. 巡检风险评估逻辑

核心代码：`backend/app/services/analysis.py`

### 8.1 统一风险引擎

后端先基于预测标签计算一个统一风险引擎：

- `inspection`
- `flood`
- `embankment`

三套结果共用同一份基础指标。

### 8.2 基础统计指标

统一引擎先计算：

- `waterline_ratio`
- `ditch_ratio`
- `dam_ratio`
- `slope_ratio`
- `scarp_ratio`
- `bareland_ratio`
- `asset_ratio`

以及组合指标：

- `flood_exposure_ratio = waterline_ratio + asset_ratio`
- `water_erosion_ratio = waterline_ratio + bareland_ratio + slope_ratio + scarp_ratio`
- `embankment_pressure_ratio = dam_ratio + waterline_ratio + slope_ratio + scarp_ratio`
- `drainage_pressure_ratio = ditch_ratio + waterline_ratio + bareland_ratio`

### 8.3 数据集基线阈值

项目不是用拍脑袋阈值，而是引入了基线区间：

- `DATASET_BASELINES`

例如：

- `waterline_ratio`
- `ditch_ratio`
- `dam_ratio`
- `slope_ratio`
- `scarp_ratio`
- `bareland_ratio`
- `asset_ratio`
- 以及几个组合指标

每个指标都有：

- `low`
- `medium`
- `high`

### 8.4 激活门槛

为了避免“只要出现某类就误报高风险”，系统还加了最小激活门槛：

- `MIN_RATIO_GATES`
- `MIN_COUNT_GATES`

也就是说，只有同时满足：

- 标签占比达到一定水平
- 该类点数达到一定规模

风险才会真正触发。

### 8.5 巡检告警类型

巡检系统当前可输出 5 类核心风险：

1. `flood_exposure`
   - 滞水目标暴露风险
   - 核心依据：水边线 + 居民地/道路暴露目标

2. `bank_erosion`
   - 岸线冲刷与裸露面风险
   - 核心依据：水边线 + 裸地 + 边坡/陡坎

3. `embankment_pressure`
   - 堤体邻近区域巡检压力
   - 核心依据：堤坝 + 水边线 + 边坡/陡坎

4. `drainage_pressure`
   - 沟渠排水异常风险
   - 核心依据：沟渠 + 水边线 + 裸地

5. `slope_instability`
   - 边坡稳定性关注项
   - 核心依据：边坡与陡坎占比

### 8.6 单条告警输出内容

每条告警包含：

- `code`
- `title`
- `level`
- `level_label`
- `score`
- `message`
- `reason`
- `suggestion`
- `metric_name`
- `metric_value`
- `metric_unit`
- `point_count`
- `ratio`

### 8.7 告警分数生成方式

分数生成不是简单映射，而是：

1. 根据阈值区间判断等级
2. 根据区间内位置计算分数
3. 分数底座为：
   - low: 40
   - medium: 65
   - high: 85
4. 在各等级区间内再做线性抬升

### 8.8 总体风险判定

如果没有任何告警：

- 输出 `normal`
- 总分默认为 `18`

如果有告警：

- 取前 3 条高优先级告警做加权
- 权重约为：
  - 第一条 `1.0`
  - 第二条 `0.4`
  - 第三条 `0.22`
- 若高风险告警数量 >= 2，会强制提高总体分数下限

总体风险等级：

- `>= 85`：高风险
- `>= 60`：中风险
- 其余：低风险

### 8.9 巡检建议生成

- 若有告警，则取各告警的 `suggestion`
- 去重后保留前 4 条
- 若无告警，则给出常规巡检与后续叠加时序数据的建议

## 9. 空间风险区域定位逻辑

核心代码：`backend/app/api/routes.py` 中 `_build_risk_regions` 及相关函数。

### 9.1 风险区域不是简单类别框选

系统并不是直接“发现某个类别就画一个框”，而是：

1. 先从巡检告警中选出告警家族
2. 把告警映射到相关类别组合
3. 从点云中提取相关类别点
4. 再做二维邻域聚类
5. 最终得到若干真正的空间区域

### 9.2 告警到空间家族的映射

例如：

- `embankment_pressure` -> `[6, 4, 5, 12]`
- `drainage_pressure` -> `[13, 12, 11]`
- `bank_erosion` -> `[12, 11, 4, 5]`
- `flood_exposure` -> `[12, 2, 3, 1, 0]`
- `slope_instability` -> `[4, 5]`

如果没有匹配的告警，还会走 fallback：

- 堤坝区域
- 水边线区域
- 沟渠区域
- 边坡区域

### 9.3 类别选择策略

对于某个候选类别组，不是全部直接纳入，而是：

- 统计候选类中各类的点数
- 保留出现过的类别
- 只保留点数达到该组最大点数 25% 以上的前 2 类

这样可以减少弱噪声类别干扰。

### 9.4 二维邻域聚类

聚类逻辑位于 `_cluster_region_points`：

- 使用 XY 平面网格划分
- 自适应估算单元格尺寸
- 使用 8 邻域连通搜索
- 小于 `min_cluster_points` 的簇被丢弃
- 如果只得到一个大簇，还会进一步细化

这比简单包围盒定位更接近真实巡检系统。

### 9.5 单个空间区域的几何指标

每个区域都会计算：

- `center`
- `bounds_min`
- `bounds_max`
- `extent`
- `footprint_area`
- `bounding_volume`
- `density_2d`
- `density_3d`
- `point_count`

### 9.6 空间评分

每个区域的空间评分 `spatial_score` 由以下部分融合：

- `span_score`
- `volume_score`
- `density_score`
- `count_score`

最终：

```text
spatial_score =
0.28 * span_score +
0.14 * volume_score +
0.36 * density_score +
0.22 * count_score
```

### 9.7 联合评分

区域最终 `combined_score` 不是单独使用告警分数，也不是单独使用空间分数，而是：

```text
combined_score = 0.56 * alert_score + 0.44 * spatial_score
```

因此“最危险区域”的判断更接近：

- 告警强度
- 空间影响范围
- 点数密度

三者联合结果。

### 9.8 区域去重

系统按 `family` 进行去重：

- 每个家族保留最强区域
- 如果同家族次级区域也足够强，则最多再保留 2 个附加区域

### 9.9 前端定位展示

前端风险定位默认是“只高亮不移动”：

- 半透明填充框
- 外侧线框
- 竖直指示柱
- 标题标签

当前不会强制改变相机中心点，避免拖动视角时中心偏移问题。

### 9.10 隐患图册视角

导出隐患图册时，前端会：

- 遍历所有风险区域
- 对每个区域单独叠加高亮
- 使用统一俯视全局视角截图
- 生成包含说明文字和图像的 HTML 图册

## 10. 防洪预警逻辑

核心后端函数：`assess_flood_risk_with_inputs`

### 10.1 基础防洪分数

先根据点云分析结果生成基础防洪分数 `_score_flood_risk(metrics)`。

融合因子包括：

- 滞水暴露
- 岸线冲刷
- 排水压力
- 堤体巡检压力
- 水边线占比
- 暴露目标占比

加权方式：

```text
score =
flood_exposure * 0.34 +
erosion * 0.20 +
drainage * 0.20 +
embankment * 0.16 +
min(waterline, 30) * 0.30 +
min(assets, 30) * 0.25
```

若水边线点数不足，还会进行扣分，减少误判。

### 10.2 人工输入因子

在基础分数上叠加：

- 当前水位 / 警戒水位 -> `water_pressure`
- 实际降雨和预测降雨 -> `rain_pressure`
- 排水状态 -> `drainage_penalty`

其中：

- `normal` -> `0`
- `limited` -> `12`
- `blocked` -> `22`

### 10.3 最终防洪分数

```text
final_score =
0.62 * base_flood_score +
0.22 * water_pressure +
0.16 * rain_pressure +
drainage_penalty
```

### 10.4 防洪等级

- `>= 82`：红色预警
- `>= 64`：橙色预警
- `>= 45`：黄色预警
- 其余：蓝色关注

### 10.5 前端行为

防洪页面默认不自动计算，必须用户输入参数并点击“计算防洪风险”后才显示结果。

计算结果会缓存到 `TaskState.floodState`：

- `inputs`
- `output`

这样切换页面返回后无需重新输入。

## 11. 堤坝岸坡隐患排查逻辑

核心后端函数：

- `assess_embankment_risk`
- `_score_embankment_risk`

### 11.1 评分因子

堤坝页使用的指标包括：

- `dam_ratio`
- `slope_ratio`
- `scarp_ratio`
- `bareland_ratio`
- `waterline_ratio`
- `asset_ratio`

### 11.2 分数公式

```text
score =
dam * 0.26 +
slope * 0.18 +
scarp * 0.18 +
bareland * 0.16 +
waterline * 0.12 +
assets * 0.10
```

### 11.3 低样本惩罚

如果：

- 堤坝点数不足
- 边坡/陡坎点数不足

则分数会再衰减，避免少量点触发高风险。

### 11.4 等级划分

- `>= 75`：高风险
- `>= 48`：中风险
- 其余：低风险

### 11.5 输出结构

返回内容包括：

- 等级
- 分数
- 摘要说明
- 风险因子解释
- 排查建议

前端会将结果缓存到 `TaskState.embankmentState.output`。

## 12. 报告与导出逻辑

核心代码：`backend/app/utils/export.py`

### 12.1 JSON 导出

接口：`GET /api/export/{file_id}?format=json`

包含：

- statistics
- inspection_alerts
- inspection
- point_count

### 12.2 CSV 导出

接口：`GET /api/export/{file_id}?format=csv`

CSV 不是导出每个点，也不是导出逐点标签，而是导出聚合统计结果：

- 语义类别统计
- 业务类别统计
- 每类点数
- 每类占比

### 12.3 自动巡检报告

接口：`GET /api/inspection-report/{file_id}`

支持格式：

- `pdf`
- `docx`
- `txt`

### 12.4 PDF 生成方式

当前 PDF 不是用专业排版引擎，而是：

- PIL 画布绘制文本
- 最终输出 PDF

优点：

- 依赖少
- 直接可运行

限制：

- 版式相对简化

### 12.5 Word 生成方式

当前 Word 导出是最小化 DOCX 结构打包：

- 手工构造 XML
- 压缩成 docx

优点：

- 无额外重型依赖

### 12.6 隐患图册导出

前端通过截图导出 HTML 图册：

- 每个风险区域一页卡片
- 包含风险标题、等级、分数、点数、涉及类别、原因说明和截图

## 13. AI 助手逻辑

后端核心代码：`backend/app/services/ai_assistant.py`

前端核心代码：`frontend/js/ai-assistant.js`

### 13.1 调用模式

支持两种：

- 普通问答：`POST /api/assistant/ask`
- 流式问答：`POST /api/assistant/ask-stream`

前端当前默认走流式接口。

### 13.2 上下文构建

AI 不是凭空回答，而是基于 `_build_assistant_context` 提供结构化上下文，包括：

- `overall_summary`
- `top_alert`
- `top_alerts`
- `top_region`
- `top_regions`
- `top_semantic_classes`
- `top_business_categories`
- `statistics`
- `inspection`
- `risk_regions`
- `fallback_regions`

### 13.3 提示词约束

系统提示词明确要求：

- 只能基于提供的上下文回答
- 使用简体中文
- 优先说明：
  - 哪里最危险
  - 为什么危险
  - 建议先检查什么
- 避免编造不存在的数据

用户提示还进一步约束：

- 优先引用 `top_alert` 和 `top_alerts`
- 再结合 `top_region` 和 `risk_regions`
- `fallback_regions` 只作补充，不能推翻主要风险结论

### 13.4 流式输出

后端调用 OpenAI Responses API 流式接口。

解析逻辑：

- 监听 `response.output_text.delta`
- 按 delta 不断向前端推送
- 前端使用 `EventSource` 风格的 SSE 解析块更新界面

### 13.5 Markdown 渲染

前端支持：

- 标题
- 段落
- 无序列表
- 有序列表
- 代码块
- 行内代码
- 引用
- 粗体

### 13.6 本地缓存

本地缓存 key：

- `waterTwinAssistantCache`

缓存粒度：

- `fileId + question`

缓存数量上限：

- `MAX_CACHE_ENTRIES = 24`

### 13.7 会话管理

本地会话存储 key：

- `waterTwinAssistantSessions`
- `waterTwinAssistantCurrentSession`

能力包括：

- 会话列表
- 当前会话切换
- 新建会话
- 删除会话
- 重命名会话
- 历史会话折叠

### 13.8 会话消息结构

每条消息会记录：

- role
- content
- model
- provider
- fromCache
- question
- questionType
- createdAt

## 14. 用户认证与安全策略

核心代码：

- `backend/app/auth.py`
- `backend/app/api/routes.py`
- `frontend/security.html`
- `frontend/js/security.js`

### 14.1 数据库存储

认证数据使用 SQLite，默认路径：

```text
backend/data/auth.db
```

### 14.2 用户表与会话表

系统初始化时自动建表：

- `users`
- `sessions`
- `auth_logs`

### 14.3 密码安全

密码不是明文存储。

采用：

- `PBKDF2-HMAC-SHA256`
- 120000 次迭代
- 随机盐

存储格式：

```text
salt$hash
```

### 14.4 密码强度策略

密码必须满足：

- 长度 8 到 64
- 至少 1 个字母
- 至少 1 个数字
- 至少 1 个特殊字符

### 14.5 用户名策略

用户名必须满足：

- 长度 3 到 32
- 只允许：
  - 字母
  - 数字
  - `_`
  - `.`
  - `-`

### 14.6 登录会话策略

登录成功后：

- 生成随机 token
- 写入 `sessions` 表
- 下发 HttpOnly Cookie

Cookie 策略：

- `httponly=True`
- `samesite="strict"`
- `secure` 可通过环境变量控制

有效期：

- 普通登录：12 小时
- 勾选“记住我”：7 天

### 14.7 登录失败与频率限制

系统同时具备两套防护：

1. 接口层限频
   - 同 IP + 用户名组合
   - 5 次失败后 300 秒限制

2. 账号层锁定
   - 用户 5 次连续失败后
   - 锁定 600 秒

### 14.8 账号冻结与解锁

管理员可：

- 冻结用户
- 解冻用户
- 解锁用户
- 重置密码
- 删除用户

被冻结用户会：

- 立即失效当前会话
- 后续访问受阻

### 14.9 默认管理员

系统初始化会确保存在默认管理员：

- 用户名：`admin`
- 密码：`admin123`

可通过环境变量覆盖：

- `WATER_TWIN_USERNAME`
- `WATER_TWIN_PASSWORD`

### 14.10 审计日志

系统会记录：

- 登录成功
- 登录失败
- 登录被锁定阻止
- 账号冻结拦截
- 注册
- 修改密码
- 解锁
- 管理员创建用户
- 管理员冻结/解冻用户
- 管理员解锁用户
- 管理员重置密码
- 管理员删除用户
- 管理员清空日志

### 14.11 审计日志异常分级

通过 `_classify_auth_event` 分级：

- `high`
  - `account_locked`
  - `login_blocked_locked`
  - `unlock_failed`
  - `admin_delete_user`
- `medium`
  - 登录失败
  - 管理员冻结用户
  - 其他失败事件
- `normal`
  - 正常操作

### 14.12 异常登录提示

登录成功时，如果发现：

- 当前登录 IP 与上次不同
- 当前 User-Agent 与上次不同

系统会返回 `security_notice`，前端右上角弹出提示。

### 14.13 管理员安全中心能力

管理员安全页支持：

- 账号统计总览
- 新增用户
- 冻结/解冻
- 解锁
- 重置密码
- 删除用户
- 清空用户审计日志
- 清空全部审计日志
- 审计日志筛选

### 14.14 安全响应头

后端统一添加：

- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`
- `Cache-Control: no-store`

## 15. 前端状态记忆与缓存机制

核心文件：`frontend/js/shared-state.js`

### 15.1 TaskState

主状态保存在 `localStorage`：

- key：`waterTwinCurrentTask`

保留字段包括：

- `fileId`
- `filename`
- `fileInfo`
- `hasPrediction`
- `currentMode`
- `currentViewMode`
- `downsample`
- `statistics`
- `alerts`
- `inspection`
- `floodState`
- `embankmentState`
- `highlightState`
- `updatedAt`

### 15.2 ViewerCache

点云大数据不适合直接进 `localStorage`，因此额外使用 `IndexedDB`：

- DB 名：`waterTwinCacheDB`
- Store 名：`viewerCache`

缓存内容包括：

- 当前 fileId 对应的单视图点云数据
- 对比视图点云数据
- 当前模式
- 当前点数限制

### 15.3 记忆效果

切换页面后再返回：

- 上次的文件仍然存在
- 统计结果仍然存在
- 高亮筛选仍然存在
- 防洪输入和结果仍然存在
- 堤坝分析结果仍然存在
- 点云视图能自动恢复

## 16. 后端 API 清单

### 16.1 认证相关

- `POST /api/auth/login`
- `POST /api/auth/register`
- `POST /api/auth/change-password`
- `POST /api/auth/unlock`
- `POST /api/auth/logout`
- `GET /api/auth/me`

### 16.2 管理员安全中心

- `GET /api/auth/security-overview`
- `POST /api/auth/admin/users`
- `POST /api/auth/admin/users/freeze`
- `POST /api/auth/admin/users/unlock`
- `POST /api/auth/admin/users/reset-password`
- `POST /api/auth/admin/users/delete`
- `POST /api/auth/admin/logs/clear`

### 16.3 点云与分割

- `POST /api/upload`
- `GET /api/files`
- `GET /api/pointcloud/{file_id}`
- `POST /api/predict/{file_id}`
- `GET /api/statistics/{file_id}`
- `GET /api/risk-regions/{file_id}`
- `GET /api/meta`

### 16.4 业务分析

- `POST /api/flood-assessment/{file_id}`
- `GET /api/embankment-assessment/{file_id}`

### 16.5 AI 助手

- `POST /api/assistant/ask`
- `POST /api/assistant/ask-stream`

### 16.6 导出

- `GET /api/export/{file_id}?format=json`
- `GET /api/export/{file_id}?format=csv`
- `GET /api/inspection-report/{file_id}?format=pdf`
- `GET /api/inspection-report/{file_id}?format=docx`
- `GET /api/inspection-report/{file_id}?format=txt`

## 17. 环境准备与启动方式

### 17.1 安装依赖

```bash
pip install -r backend/requirements.txt
```

当前 `backend/requirements.txt` 包含：

- `fastapi==0.115.0`
- `uvicorn==0.30.0`
- `python-multipart==0.0.9`
- `numpy>=1.24.0`
- `torch>=2.0.0`
- `aiofiles==24.1.0`

### 17.2 启动项目

```bash
python run.py
```

启动后访问：

```text
http://localhost:8000
```

系统根路径会自动跳转到：

```text
/login.html
```

## 18. PointNet 模型目录配置

当前模型路径配置在：

- `backend/app/config.py`

项目当前写死为：

```python
POINTNET_DIR = r"E:\desktop\graduate_project\pointnet"
MODEL_CHECKPOINT = os.path.join(
    POINTNET_DIR,
    "log", "pointnet_sem_seg", "2026-04-05_21-02", "checkpoints", "best_model.pth"
)
```

### 18.1 是否必须保留整个 `pointnet` 文件夹

从当前代码实现看，不是只要 `best_model.pth` 就够。

因为运行时还依赖：

- `POINTNET_DIR/models/pointnet_sem_seg.py`
- 以及 PointNet 项目内部相关模块

也就是说：

- `best_model.pth` 只是权重
- `pointnet` 文件夹还提供模型结构代码

### 18.2 如果把 PointNet 放到别的位置

只需修改：

- `backend/app/config.py`

例如改为：

```python
POINTNET_DIR = r"E:\desktop\pointnet"
```

前提是目录结构仍满足：

```text
POINTNET_DIR/
├─ models/
│  └─ pointnet_sem_seg.py
└─ log/
   └─ pointnet_sem_seg/
      └─ .../checkpoints/best_model.pth
```

## 19. 数据库说明

项目当前数据库是 SQLite。

### 19.1 数据库文件位置

默认：

```text
backend/data/auth.db
```

也可通过环境变量自定义：

```text
WATER_TWIN_DB_PATH
```

### 19.2 表结构

#### `users`

主要字段：

- `id`
- `username`
- `password_hash`
- `created_at`
- `updated_at`
- `failed_attempts`
- `locked_until`
- `last_login_at`
- `last_login_ip`
- `last_login_user_agent`
- `role`
- `is_frozen`

#### `sessions`

- `token`
- `username`
- `expires_at`
- `created_at`

#### `auth_logs`

- `id`
- `username`
- `event_type`
- `success`
- `ip_address`
- `user_agent`
- `detail`
- `created_at`

## 20. AI 配置文件说明

配置文件：

- `backend/config/ai_settings.json`
- 示例文件：`backend/config/ai_settings.example.json`

当前字段包括：

- `enabled`
- `provider`
- `base_url`
- `model`
- `api_key`
- `system_prompt`

示例：

```json
{
  "enabled": true,
  "provider": "openai",
  "base_url": "https://api.openai.com/v1",
  "model": "gpt-5-nano",
  "api_key": "replace-with-your-openai-api-key",
  "system_prompt": "你是水利数字孪生系统的风险分析助手..."
}
```

当前后端只支持：

- `provider = openai`
- 接口地址为 `base_url + /responses`

## 21. 适合扩展的实际应用方向

基于你当前项目，已经比较适合继续往以下方向扩展：

- 防洪预警系统：接入真实雨情、水位、站点数据和时序阈值。
- 堤坝巡检系统：接入人工巡检工单、历史照片、维修闭环。
- 岸坡稳定性监测：引入多时相点云差分。
- 风险热力图/GIS 联动：叠加底图、行政区、河道断面、站点信息。
- 多任务项目管理：一个系统管理多个工程、多个时段、多个测区。
- 智能报告平台：导出更正式的 PDF 模板、图文混排、签章页。
- 大模型巡检助手：把规则引擎和大模型结合，做解释型风险辅助决策。

## 22. 当前实现边界与注意事项

- 当前点云分析结果缓存在后端内存 `_cache` 中，后端重启后会丢失。
- 登录与用户数据是持久化到 SQLite 的，不会因服务重启丢失。
- 风险评估逻辑是规则引擎，不是监督学习的风险模型。
- 空间定位已比单纯类别映射更真实，但本质仍是标签驱动的聚类定位，不是完整 GIS 拓扑分析。
- PDF/Word 导出为轻量实现，适合课程设计与原型验证，但不等同于企业级排版引擎。
- AI 助手质量依赖：
  - 当前分析结果是否完整
  - `ai_settings.json` 是否正确配置
  - 外部大模型接口是否可用
- 原始标签对比功能依赖点云中存在 `label_id`。
- PointNet 外部目录不能只剩权重文件，模型结构代码也必须存在。

