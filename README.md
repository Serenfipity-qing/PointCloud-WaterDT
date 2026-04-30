# Water Twin System

基于点云语义分割的水利数字孪生巡检与风险分析系统。

该项目面向水利场景点云数据，提供从点云上传、语义分割、三维可视化、分类统计、风险区域定位，到巡检报告导出、防洪预警辅助、堤坝岸坡隐患排查、AI 风险问答的一体化工作流。

## 项目特点

- 点云文件上传与管理，支持 `.pth` / `.npy`
- 基于 PointNet 的点云语义分割推理
- 原始点云、语义着色、业务着色三种可视化模式
- 原始标签与预测结果对比查看
- 类别图例与业务统计联动高亮、筛选显示
- 风险区域定位、风险标记、截图导出、隐患图册导出
- 分类统计结果导出与自动巡检报告导出
- 防洪预警辅助分析
- 堤坝岸坡隐患排查
- AI 助手基于当前分析结果进行问答
- 登录、注册、修改密码，用户信息基于 SQLite 存储

## 功能概览

### 1. 点云分析

- 上传原始点云文件
- 执行语义分割
- 查看原始点云与预测结果
- 支持语义类别和业务类别的高亮筛选
- 支持风险区域定位与可视化标记

### 2. 统计与导出

- 语义类别点数占比统计
- 业务类别点数占比统计
- 导出 JSON / CSV
- 导出 PDF / Word 巡检报告
- 导出隐患图册

### 3. 巡检提示

- 输出巡检告警摘要
- 生成重点巡检建议
- 提供风险解释信息

### 4. 防洪预警辅助

- 输入实时水位、警戒水位、降雨量、预测降雨量、排水状态
- 结合点云分析结果进行综合风险评分

### 5. 堤坝岸坡隐患排查

- 基于统一评分引擎输出堤坝、岸坡、沟渠、水边线等风险判断
- 支持空间风险区域识别与定位

### 6. AI 助手

- 基于当前任务分析结果回答风险问题
- 支持自由输入问题
- 支持流式输出
- 支持 Markdown 渲染、历史会话、导出 Markdown

## 页面结构

当前前端主要包含以下页面：

- `login.html`：登录页
- `register.html`：注册页
- `change-password.html`：修改密码页
- `viewer.html`：点云分析页
- `report.html`：统计与导出页
- `inspection.html`：巡检提示页
- `flood.html`：防洪预警辅助页
- `embankment.html`：堤坝岸坡隐患排查页
- `ai.html`：AI 助手页

系统根路径默认会跳转到登录页：

```text
http://localhost:8000 -> /login.html
```

## 技术栈

### 后端

- FastAPI
- Uvicorn
- PyTorch
- NumPy
- SQLite
- aiofiles

### 前端

- HTML
- CSS
- JavaScript
- Three.js

### 模型

- PointNet Semantic Segmentation

## 项目结构

```text
water_twin_system/
|-- backend/
|   |-- app/
|   |   |-- api/
|   |   |   `-- routes.py
|   |   |-- core/
|   |   |   |-- model_interface.py
|   |   |   `-- pointcloud_loader.py
|   |   |-- services/
|   |   |   |-- ai_assistant.py
|   |   |   `-- analysis.py
|   |   |-- utils/
|   |   |   `-- export.py
|   |   |-- auth.py
|   |   |-- config.py
|   |   `-- main.py
|   |-- config/
|   |   |-- ai_settings.example.json
|   |   `-- ai_settings.json
|   |-- data/
|   |   |-- auth.db
|   |   |-- raw/
|   |   |-- processed/
|   |   `-- results/
|   `-- requirements.txt
|-- frontend/
|   |-- assets/
|   |-- css/
|   |   `-- style.css
|   |-- js/
|   |   |-- ai-assistant.js
|   |   |-- app.js
|   |   |-- auth.js
|   |   |-- embankment.js
|   |   |-- flood.js
|   |   |-- inspection.js
|   |   |-- overview.js
|   |   |-- report.js
|   |   `-- shared-state.js
|   |-- ai.html
|   |-- change-password.html
|   |-- embankment.html
|   |-- flood.html
|   |-- index.html
|   |-- inspection.html
|   |-- login.html
|   |-- register.html
|   |-- report.html
|   `-- viewer.html
|-- pointnet/
|-- tests/
|-- run.py
`-- README.md
```

## 语义类别

当前项目使用 15 个语义类别：

| ID | 英文类别 | 中文类别 | 业务分类 |
|---|---|---|---|
| 0 | Shed | 棚屋 | 居民地设施 |
| 1 | Concretehouse | 混凝土房屋 | 居民地设施 |
| 2 | Cementroad | 水泥路 | 交通 |
| 3 | Dirtroad | 土路 | 交通 |
| 4 | Slope | 边坡 | 地形 |
| 5 | Scarp | 陡坎 | 地形 |
| 6 | Dam | 堤坝 | 水工结构 |
| 7 | Vegetablefield | 菜地 | 植被农田 |
| 8 | Grassland | 草地 | 植被农田 |
| 9 | Dryland | 旱地 | 植被农田 |
| 10 | Woodland | 林地 | 植被农田 |
| 11 | Bareland | 裸地 | 地形 |
| 12 | Waterline | 水边线 | 水系 |
| 13 | Ditch | 沟渠 | 水系 |
| 14 | Others | 其他 | 其他 |

## 快速开始

### 1. 克隆项目

```bash
git clone <your-repo-url>
cd water_twin_system
```

### 2. 安装依赖

建议使用独立 Python 环境：

```bash
pip install -r backend/requirements.txt
```

### 3. 准备模型权重

当前配置的 PointNet 权重路径为：

```text
pointnet/log/pointnet_sem_seg/2026-04-05_21-02/checkpoints/best_model.pth
```

如果你的模型权重路径不同，请同步修改：

- `backend/app/config.py`

### 4. 启动项目

```bash
python run.py
```

启动后访问：

```text
http://localhost:8000
```

## 数据格式

项目当前主要面向 `(N, 7)` 结构的点云数组，默认字段格式如下：

```text
x, y, z, r, g, b, label_id
```

字段说明：

- `x, y, z`：三维坐标
- `r, g, b`：颜色信息
- `label_id`：原始标签，用于原始标签可视化与对比分析

## 用户认证与数据库

当前登录系统使用 SQLite，本地数据库文件默认位于：

```text
backend/data/auth.db
```

认证相关代码位于：

- `backend/app/auth.py`

系统支持：

- 用户注册
- 用户登录
- 修改密码
- 当前用户信息获取

## AI 助手配置

AI 助手配置文件位于：

```text
backend/config/ai_settings.json
```

示例配置文件：

```text
backend/config/ai_settings.example.json
```

可以配置的核心参数包括：

- `enabled`
- `provider`
- `base_url`
- `model`
- `api_key`
- `system_prompt`

## 主要 API

### 认证接口

- `POST /api/auth/login`
- `POST /api/auth/register`
- `POST /api/auth/change-password`
- `POST /api/auth/logout`
- `GET /api/auth/me`

### 点云与分割接口

- `POST /api/upload`
- `GET /api/files`
- `GET /api/pointcloud/{file_id}`
- `POST /api/predict/{file_id}`
- `GET /api/statistics/{file_id}`
- `GET /api/risk-regions/{file_id}`

### 导出接口

- `GET /api/export/{file_id}`
- `GET /api/inspection-report/{file_id}`

### 业务分析接口

- `POST /api/flood-assessment/{file_id}`
- `GET /api/embankment-assessment/{file_id}`

### AI 助手接口

- `POST /api/assistant/ask`
- `POST /api/assistant/ask-stream`

## 使用流程

1. 登录系统
2. 上传点云文件
3. 执行语义分割
4. 在点云分析页查看原始标签与预测结果
5. 在统计页查看类别占比并导出结果
6. 在巡检、防洪、堤坝、AI 助手页面继续完成风险分析

## 项目亮点

- 将点云语义分割、三维可视化与风险分析结合到同一个系统中
- 面向水利巡检业务，具备较强的课程设计与项目展示价值
- 支持从“数据处理”到“报告导出”再到“AI 问答”的完整闭环
- 适合继续扩展为防洪预警、隐患排查、数字孪生巡检平台

## 后续可扩展方向

- 接入真实水位、雨情、气象 API
- 增加时序点云变化检测
- 增加多任务、多项目管理
- 增加地图底图与 GIS 联动
- 增加真实巡检工单流转
- 增加更强的空间聚类与隐患评分模型

## 注意事项

- 上传的点云文件建议包含 `label_id`，否则无法进行原始标签对比可视化
- 首次运行前请确认模型权重路径存在
- 若启用 AI 助手，需要在 `backend/config/ai_settings.json` 中正确填写模型配置
- 当前用户数据默认保存在本地 SQLite 文件中，适合开发与课程设计场景

## License

当前仓库未显式声明开源许可证。如需开源发布，建议补充 `MIT`、`Apache-2.0` 或其他许可证文件。
