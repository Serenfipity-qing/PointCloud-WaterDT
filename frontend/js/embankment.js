let embankmentTask = window.TaskState?.read?.();
const embankmentTaskCard = document.getElementById('embankmentTaskCard');
const embankmentRiskLevel = document.getElementById('embankmentRiskLevel');
const embankmentRiskScore = document.getElementById('embankmentRiskScore');
const embankmentRiskSummary = document.getElementById('embankmentRiskSummary');
const embankmentFactors = document.getElementById('embankmentFactors');
const embankmentActions = document.getElementById('embankmentActions');
const embankmentMetrics = {
    dam: document.getElementById('metricDam'),
    slope: document.getElementById('metricSlope'),
    scarp: document.getElementById('metricScarp'),
    bareland: document.getElementById('metricBareland'),
    waterline: document.getElementById('metricWaterline'),
    assets: document.getElementById('metricAssets'),
};
const EMBANKMENT_API_BASE = window.WATER_TWIN_API || '';

renderEmbankmentTask();
renderEmbankmentAssessment().catch((err) => {
    console.warn('Failed to render embankment assessment.', err);
});

function renderEmbankmentTask() {
    if (!embankmentTaskCard) return;
    if (!embankmentTask || !embankmentTask.fileId || !embankmentTask.hasPrediction) {
        embankmentTaskCard.innerHTML = `
            <div class="sidebar-label">当前任务</div>
            <div class="sidebar-value">未分析</div>
            <div class="sidebar-text">请先在点云分析页完成分割任务。</div>
        `;
        return;
    }

    embankmentTaskCard.innerHTML = `
        <div class="sidebar-label">当前任务</div>
        <div class="sidebar-value">${embankmentTask.filename || embankmentTask.fileId}</div>
        <div class="sidebar-text">文件 ID：${embankmentTask.fileId}</div>
        <div class="sidebar-text">当前页面用于堤坝岸坡隐患排查。</div>
    `;
}

async function renderEmbankmentAssessment() {
    embankmentTask = window.TaskState?.read?.() || embankmentTask;
    const ratios = embankmentTask?.inspection?.metrics?.ratios || {};
    const dam = readRatio(ratios.dam_ratio);
    const slope = readRatio(ratios.slope_ratio);
    const scarp = readRatio(ratios.scarp_ratio);
    const bareland = readRatio(ratios.bareland_ratio);
    const waterline = readRatio(ratios.waterline_ratio);
    const assets = readRatio(ratios.asset_ratio);

    setMetric(embankmentMetrics.dam, dam);
    setMetric(embankmentMetrics.slope, slope);
    setMetric(embankmentMetrics.scarp, scarp);
    setMetric(embankmentMetrics.bareland, bareland);
    setMetric(embankmentMetrics.waterline, waterline);
    setMetric(embankmentMetrics.assets, assets);

    if (!embankmentTask?.hasPrediction || !embankmentTask?.fileId) {
        applyAssessment(null, dam, slope, scarp, bareland, waterline, assets);
        return;
    }

    let assessment = embankmentTask?.embankmentState?.output || null;
    if (!assessment) {
        const res = await fetch(`${EMBANKMENT_API_BASE}/api/embankment-assessment/${embankmentTask.fileId}`, {
            credentials: 'include',
        });
        if (!res.ok) {
            const error = await res.json().catch(() => ({}));
            throw new Error(error.detail || '堤坝岸坡评估失败');
        }

        const data = await res.json();
        assessment = data.assessment || null;
        embankmentTask = window.TaskState?.write?.({
            embankmentState: {
                output: assessment,
            },
        }) || {
            ...(embankmentTask || {}),
            embankmentState: { output: assessment },
        };
    }
    applyAssessment(assessment, dam, slope, scarp, bareland, waterline, assets);
}

function applyAssessment(assessment, dam, slope, scarp, bareland, waterline, assets) {
    if (!assessment) {
        if (embankmentRiskLevel) embankmentRiskLevel.textContent = '等待计算';
        if (embankmentRiskScore) embankmentRiskScore.textContent = '-';
        if (embankmentRiskSummary) embankmentRiskSummary.textContent = '请先完成点云分割，系统才能结合标签占比进行岸坡隐患判断。';
        renderList(embankmentFactors, [], '暂无可用风险因素');
        renderList(embankmentActions, ['请先完成点云语义分割后再进行排查。'], '暂无建议');
        return;
    }

    if (embankmentRiskLevel) embankmentRiskLevel.textContent = assessment.level_label || '-';
    if (embankmentRiskScore) embankmentRiskScore.textContent = Math.round(readRatio(assessment.score));
    if (embankmentRiskSummary) embankmentRiskSummary.textContent = assessment.summary || '暂无说明';

    renderList(
        embankmentFactors,
        assessment.factors || [
            `坝体占比 ${dam.toFixed(2)}%，用于判断堤坝结构是否在当前场景中占据主要位置。`,
            `边坡占比 ${slope.toFixed(2)}%，用于反映坡面稳定性关注程度。`,
            `陡坎占比 ${scarp.toFixed(2)}%，通常与岸坡失稳、局部坍塌相关。`,
            `裸地占比 ${bareland.toFixed(2)}%，可用于观察冲刷、退化和暴露地表。`,
            `水边线占比 ${waterline.toFixed(2)}%，提示临水边界压力。`,
            `居民地/道路暴露 ${assets.toFixed(2)}%，提示岸坡附近目标受影响程度。`,
        ],
        '暂无可用风险因素'
    );
    renderList(embankmentActions, assessment.actions || [], '暂无建议');
}

function renderList(container, items, emptyText) {
    if (!container) return;
    container.innerHTML = items.length
        ? items.map((item) => `<div class="stack-row"><span>${item}</span></div>`).join('')
        : `<div class="empty-copy">${emptyText}</div>`;
}

function setMetric(el, value) {
    if (el) el.textContent = `${value.toFixed(2)}%`;
}

function readRatio(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}
