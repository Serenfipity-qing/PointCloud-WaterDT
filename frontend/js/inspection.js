const inspectionTask = window.TaskState?.read?.();
const inspectionTaskCard = document.getElementById('inspectionTaskCard');
const inspectionAlerts = document.getElementById('inspectionAlerts');
const inspectionAlertCount = document.getElementById('inspectionAlertCount');
const inspectionHighCount = document.getElementById('inspectionHighCount');
const inspectionOverallLevel = document.getElementById('inspectionOverallLevel');
const inspectionOverallScore = document.getElementById('inspectionOverallScore');
const inspectionSummaryTitle = document.getElementById('inspectionSummaryTitle');
const inspectionSummaryMessage = document.getElementById('inspectionSummaryMessage');
const inspectionRecommendations = document.getElementById('inspectionRecommendations');
const INSPECTION_API_BASE = window.WATER_TWIN_API || '';

renderInspection().catch((err) => {
    console.warn('Failed to render inspection page.', err);
    renderInspectionEmpty('巡检结果加载失败');
});

async function renderInspection() {
    if (!inspectionTask || !inspectionTask.fileId || !inspectionTask.hasPrediction) {
        renderInspectionEmpty('请先在点云分析页完成分割任务');
        return;
    }

    let taskState = inspectionTask;
    if (!taskState.inspection) {
        try {
            const res = await fetch(`${INSPECTION_API_BASE}/api/statistics/${taskState.fileId}`, { credentials: 'include' });
            if (res.ok) {
                const data = await res.json();
                taskState = window.TaskState?.write?.({
                    statistics: data.statistics,
                    alerts: data.alerts,
                    inspection: data.inspection || null,
                }) || {
                    ...taskState,
                    statistics: data.statistics,
                    alerts: data.alerts,
                    inspection: data.inspection || null,
                };
            }
        } catch (err) {
            console.warn('Failed to fetch inspection payload.', err);
        }
    }

    const inspection = taskState.inspection || buildInspectionFallback(taskState.alerts || []);
    const alerts = inspection.alerts || taskState.alerts || [];
    const high = alerts.filter((item) => item.level === 'high').length;
    const mediumAndLow = alerts.filter((item) => item.level === 'medium' || item.level === 'low').length;

    inspectionTaskCard.innerHTML = `
        <div class="sidebar-label">当前任务</div>
        <div class="sidebar-value">${taskState.filename || taskState.fileId}</div>
        <div class="sidebar-text">文件 ID：${taskState.fileId}</div>
        <div class="sidebar-text">分割状态：已完成</div>
        <div class="sidebar-text">巡检依据：按标签点数占比与组合关系评估</div>
    `;

    inspectionOverallLevel.textContent = inspection.overall?.level_label || '-';
    inspectionOverallScore.textContent = inspection.overall?.score ?? '-';
    inspectionHighCount.textContent = high;
    inspectionAlertCount.textContent = mediumAndLow;
    inspectionSummaryTitle.textContent = inspection.overall?.title || '当前场景缺少总体研判';
    inspectionSummaryMessage.textContent = inspection.overall?.message || '暂无说明';

    const recommendations = inspection.recommendations || [];
    inspectionRecommendations.innerHTML = recommendations.length
        ? recommendations.map((item) => `<div class="stack-row"><span>${item}</span></div>`).join('')
        : '<div class="empty-copy">暂无建议</div>';

    inspectionAlerts.innerHTML = alerts.length
        ? alerts.map((alert) => `
            <div class="alert-item alert-${alert.level}">
                <div class="alert-title">
                    ${alert.title || alert.class_name_cn}
                    <span class="alert-badge ${alert.level}">${alert.level_label || levelLabel(alert.level)}</span>
                </div>
                <div>${alert.message || ''}</div>
                <div style="margin-top:6px;color:var(--text-light);">${alert.reason || ''}</div>
                <div style="margin-top:6px;">
                    <strong>${alert.metric_name || '风险指标'}：</strong>
                    ${formatMetric(alert.metric_value, alert.metric_unit)} | 风险分数 ${alert.score ?? '-'}
                </div>
                <div style="margin-top:6px;color:var(--text-light);">关联点数：${Number(alert.point_count || 0).toLocaleString()}</div>
                <div style="margin-top:6px;"><strong>建议：</strong>${alert.suggestion || '暂无建议'}</div>
            </div>
        `).join('')
        : '<div class="empty-copy">当前场景未触发显著风险告警</div>';
}

function renderInspectionEmpty(message) {
    inspectionTaskCard.innerHTML = `
        <div class="sidebar-label">当前任务</div>
        <div class="sidebar-value">未分析</div>
        <div class="sidebar-text">${message}</div>
    `;
    inspectionOverallLevel.textContent = '-';
    inspectionOverallScore.textContent = '-';
    inspectionHighCount.textContent = '-';
    inspectionAlertCount.textContent = '-';
    inspectionSummaryTitle.textContent = '等待分析结果';
    inspectionSummaryMessage.textContent = message;
    inspectionRecommendations.innerHTML = '<div class="empty-copy">暂无建议</div>';
    inspectionAlerts.innerHTML = '<div class="empty-copy">暂无告警</div>';
}

function buildInspectionFallback(alerts) {
    if (!alerts.length) {
        return {
            overall: {
                level_label: '低风险',
                score: 18,
                title: '当前场景整体风险较低',
                message: '未发现明显高占比风险组合，可按常规周期巡检。',
            },
            alerts: [],
            recommendations: ['建议继续积累点云样本与时序数据，提升趋势分析能力。'],
        };
    }

    const sortedAlerts = [...alerts].sort((a, b) => (b.score || 0) - (a.score || 0));
    const top = sortedAlerts[0];
    return {
        overall: {
            level_label: top.level_label || levelLabel(top.level),
            score: top.score || 60,
            title: `当前场景重点关注“${top.title || top.class_name_cn}”`,
            message: top.message || '请优先复核当前最高风险项。',
        },
        alerts: sortedAlerts,
        recommendations: sortedAlerts.map((item) => item.suggestion).filter(Boolean).slice(0, 4),
    };
}

function levelLabel(level) {
    if (level === 'high') return '高风险';
    if (level === 'medium') return '中风险';
    return '低风险';
}

function formatMetric(value, unit) {
    if (value === undefined || value === null || Number.isNaN(Number(value))) {
        return '-';
    }
    return `${Number(value).toFixed(2)}${unit || ''}`;
}
