let floodTask = window.TaskState?.read?.();
const floodForm = document.getElementById('floodForm');
const floodTaskCard = document.getElementById('floodTaskCard');
const floodLevelText = document.getElementById('floodLevelText');
const floodScoreText = document.getElementById('floodScoreText');
const floodSummaryText = document.getElementById('floodSummaryText');
const floodScoreBar = document.getElementById('floodScoreBar');
const metricFloodExposure = document.getElementById('metricFloodExposure');
const metricErosion = document.getElementById('metricErosion');
const metricDrainage = document.getElementById('metricDrainage');
const metricWaterLevel = document.getElementById('metricWaterLevel');
const floodFactors = document.getElementById('floodFactors');
const floodActions = document.getElementById('floodActions');
const FLOOD_API_BASE = window.WATER_TWIN_API || '';

renderFloodTask();
restoreFloodFormState();
restoreFloodResultState();

floodForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    calculateFloodRisk().catch((err) => {
        console.warn('Failed to calculate flood risk.', err);
    });
});

function renderFloodTask() {
    if (!floodTaskCard) return;
    if (!floodTask || !floodTask.fileId || !floodTask.hasPrediction) {
        floodTaskCard.innerHTML = `
            <div class="sidebar-label">当前任务</div>
            <div class="sidebar-value">未分析</div>
            <div class="sidebar-text">请先在点云分析页完成分割任务。</div>
        `;
        return;
    }

    floodTaskCard.innerHTML = `
        <div class="sidebar-label">当前任务</div>
        <div class="sidebar-value">${floodTask.filename || floodTask.fileId}</div>
        <div class="sidebar-text">文件 ID: ${floodTask.fileId}</div>
        <div class="sidebar-text">已接入点云语义结果，可计算防洪预警。</div>
    `;
}

function restoreFloodFormState() {
    const inputs = floodTask?.floodState?.inputs;
    if (!floodForm || !inputs) {
        return;
    }

    const mapping = {
        water_level: inputs.water_level,
        warning_level: inputs.warning_level,
        rainfall: inputs.rainfall,
        forecast_rainfall: inputs.forecast_rainfall,
        drainage_status: inputs.drainage_status,
    };

    Object.entries(mapping).forEach(([name, value]) => {
        const field = floodForm.elements.namedItem(name);
        if (field && value !== undefined && value !== null) {
            field.value = String(value);
        }
    });
}

function restoreFloodResultState() {
    const output = floodTask?.floodState?.output;
    const inputs = floodTask?.floodState?.inputs;
    if (!output || !inputs) {
        resetFloodResultView();
        return;
    }
    applyFloodAssessment(output, inputs);
}

async function calculateFloodRisk() {
    floodTask = window.TaskState?.read?.() || floodTask;
    const formData = new FormData(floodForm);
    const cachedFloodState = floodTask?.floodState || {};
    const inputs = {
        water_level: readNumber(formData.get('water_level') ?? cachedFloodState.inputs?.water_level, 0),
        warning_level: Math.max(readNumber(formData.get('warning_level') ?? cachedFloodState.inputs?.warning_level, 1), 0.1),
        rainfall: readNumber(formData.get('rainfall') ?? cachedFloodState.inputs?.rainfall, 0),
        forecast_rainfall: readNumber(formData.get('forecast_rainfall') ?? cachedFloodState.inputs?.forecast_rainfall, 0),
        drainage_status: String(formData.get('drainage_status') || cachedFloodState.inputs?.drainage_status || 'normal'),
    };

    let assessment = null;
    if (floodTask?.hasPrediction && floodTask?.fileId) {
        const res = await fetch(`${FLOOD_API_BASE}/api/flood-assessment/${floodTask.fileId}`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(inputs),
        });

        if (!res.ok) {
            const error = await res.json().catch(() => ({}));
            throw new Error(error.detail || '防洪评估失败');
        }

        const data = await res.json();
        assessment = data.assessment || null;
    }

    const nextFloodState = {
        inputs,
        output: assessment,
    };
    floodTask = window.TaskState?.write?.({ floodState: nextFloodState }) || {
        ...(floodTask || {}),
        floodState: nextFloodState,
    };

    applyFloodAssessment(assessment, inputs);
}

function applyFloodAssessment(assessment, inputs) {
    const ratios = floodTask?.inspection?.metrics?.ratios || {};
    const floodEngine = floodTask?.inspection?.flood || {};
    const waterLevel = readNumber(inputs?.water_level, 0);
    const warningLevel = Math.max(readNumber(inputs?.warning_level, 1), 0.1);
    const rainfall = readNumber(inputs?.rainfall, 0);
    const forecastRainfall = readNumber(inputs?.forecast_rainfall, 0);
    const drainageStatus = String(inputs?.drainage_status || 'normal');
    const floodExposure = readNumber(ratios.flood_exposure_ratio, 0);
    const erosion = readNumber(ratios.water_erosion_ratio, 0);
    const drainage = readNumber(ratios.drainage_pressure_ratio, 0);
    const embankment = readNumber(ratios.embankment_pressure_ratio, 0);
    const fallbackWaterPressure = Math.min((waterLevel / warningLevel) * 100, 140);
    const waterPressure = readNumber(assessment?.water_pressure, fallbackWaterPressure);
    const score = readNumber(assessment?.score, 0);
    const level = assessment?.level || 'blue';
    const levelText = assessment?.level_label || '蓝色关注';

    metricFloodExposure.textContent = `${floodExposure.toFixed(1)}%`;
    metricErosion.textContent = `${erosion.toFixed(1)}%`;
    metricDrainage.textContent = `${drainage.toFixed(1)}%`;
    metricWaterLevel.textContent = `${Math.min(waterPressure, 100).toFixed(0)}%`;

    floodLevelText.textContent = levelText;
    floodLevelText.className = `flood-level flood-level-${level}`;
    floodScoreText.textContent = Math.round(score);
    floodSummaryText.textContent = assessment?.summary || buildSummary(level, waterPressure, rainfall, floodExposure);
    floodScoreBar.style.width = `${score}%`;
    floodScoreBar.className = `flood-score-fill flood-level-${level}`;

    renderList(
        floodFactors,
        assessment?.factors || buildFactors({
            waterPressure,
            rainPressure: Math.min(rainfall * 0.7 + forecastRainfall * 0.9, 100),
            floodExposure,
            erosion,
            drainage,
            embankment,
            drainageStatus,
            floodSummary: floodEngine.summary || '',
        })
    );
    renderList(floodActions, assessment?.actions || buildActions(level, drainageStatus, floodTask?.hasPrediction));
}

function resetFloodResultView() {
    if (metricFloodExposure) metricFloodExposure.textContent = '-';
    if (metricErosion) metricErosion.textContent = '-';
    if (metricDrainage) metricDrainage.textContent = '-';
    if (metricWaterLevel) metricWaterLevel.textContent = '-';
    if (floodLevelText) {
        floodLevelText.textContent = '等待计算';
        floodLevelText.className = 'flood-level';
    }
    if (floodScoreText) floodScoreText.textContent = '-';
    if (floodSummaryText) {
        floodSummaryText.textContent = '请输入水情参数，点击“计算防洪风险”后再显示结果。';
    }
    if (floodScoreBar) {
        floodScoreBar.style.width = '0%';
        floodScoreBar.className = 'flood-score-fill';
    }
    renderList(floodFactors, []);
    renderList(floodActions, []);
}

function buildFactors(data) {
    const factors = [];
    if (data.floodSummary) factors.push(data.floodSummary);
    factors.push(`水位接近警戒线 ${Math.min(data.waterPressure, 100).toFixed(0)}%，水位压力参与综合评分。`);
    factors.push(`降雨压力指数 ${data.rainPressure.toFixed(0)}，由 24h 降雨和未来 6h 预报降雨计算。`);
    if (data.floodExposure > 0) factors.push(`临水暴露指数 ${data.floodExposure.toFixed(1)}%，反映水边线附近居民地和道路占比。`);
    if (data.erosion > 0) factors.push(`岸线冲刷指数 ${data.erosion.toFixed(1)}%，反映水边线、裸地、边坡和堤坝组合压力。`);
    if (data.drainage > 0) factors.push(`排水压力指数 ${data.drainage.toFixed(1)}%，反映沟渠、水边线和裸地组合压力。`);
    if (data.embankment > 0) factors.push(`堤体巡检压力指数 ${data.embankment.toFixed(1)}%，用于判断坝体邻近区域关注程度。`);
    if (data.drainageStatus !== 'normal') factors.push('人工输入显示排水状态异常，已额外提高预警分数。');
    return factors;
}

function buildActions(level, drainageStatus, hasPrediction) {
    if (!hasPrediction) {
        return ['请先完成点云语义分割，系统才能引入地物占比进行防洪预警。'];
    }

    const actions = {
        red: ['立即组织重点区巡查，优先核查水边线附近居民地、道路和堤体区域。', '启动防汛值守和现场复核，必要时设置临时警戒或绕行路线。'],
        orange: ['提高巡查频率，重点关注沟渠排水、岸坡冲刷和低洼通行区域。', '结合雨情和水位变化，准备抢险物资和人员调度方案。'],
        yellow: ['安排常规加密巡查，复核水边线、沟渠和裸地异常区域。', '持续观察未来降雨和水位接近度，必要时升级预警等级。'],
        blue: ['保持常规巡查，记录当前点云分析结果作为后续时序对比基线。'],
    }[level];

    if (drainageStatus !== 'normal') {
        actions.push('优先检查沟渠是否存在淤积、堵塞、断面收窄或排水不畅。');
    }
    return actions;
}

function buildSummary(level, waterPressure, rainfall, floodExposure) {
    if (!floodTask?.hasPrediction) {
        return '当前缺少点云分割结果，仅能根据水情参数进行粗略判断。';
    }
    if (level === 'red') return '综合水位、降雨和点云暴露目标占比，当前防洪风险很高，需要立即复核。';
    if (level === 'orange') return '当前存在明显防洪压力，建议提高巡查频率并关注重点风险区域。';
    if (level === 'yellow') return '当前达到关注阈值，建议持续观察水位、降雨和临水暴露目标变化。';
    return `当前整体风险较低，水位接近度 ${Math.min(waterPressure, 100).toFixed(0)}%，24h 降雨 ${rainfall.toFixed(0)} mm，临水暴露指数 ${floodExposure.toFixed(1)}%。`;
}

function renderList(container, items) {
    if (!container) return;
    container.innerHTML = items.length
        ? items.map((item) => `<div class="stack-row"><span>${item}</span></div>`).join('')
        : '<div class="empty-copy">暂无数据</div>';
}

function readNumber(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}
