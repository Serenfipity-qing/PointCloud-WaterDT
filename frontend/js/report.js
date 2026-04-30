const REPORT_API_BASE = window.WATER_TWIN_API || '';
const currentTask = window.TaskState?.read?.();

const taskCard = document.getElementById('reportTaskCard');
const totalPointsEl = document.getElementById('metricTotalPoints');
const classCountEl = document.getElementById('metricClassCount');
const businessCountEl = document.getElementById('metricBusinessCount');
const taskStateEl = document.getElementById('metricTaskState');
const classStatsList = document.getElementById('classStatsList');
const businessStatsList = document.getElementById('reportBusinessStats');
const btnExportJson = document.getElementById('btnExportJson');
const btnExportCsv = document.getElementById('btnExportCsv');
const btnInspectionPdf = document.getElementById('btnInspectionPdf');
const btnInspectionDocx = document.getElementById('btnInspectionDocx');

btnExportJson?.addEventListener('click', () => exportCurrent('json'));
btnExportCsv?.addEventListener('click', () => exportCurrent('csv'));
btnInspectionPdf?.addEventListener('click', () => exportInspectionReport('pdf'));
btnInspectionDocx?.addEventListener('click', () => exportInspectionReport('docx'));

renderReport();

function renderReport() {
    if (!currentTask || !currentTask.fileId) {
        renderEmptyState();
        return;
    }

    taskCard.innerHTML = `
        <div class="sidebar-label">当前任务</div>
        <div class="sidebar-value">${currentTask.filename || currentTask.fileId}</div>
        <div class="sidebar-text">文件 ID：${currentTask.fileId}</div>
        <div class="sidebar-text">分割状态：${currentTask.hasPrediction ? '已完成' : '未完成'}</div>
    `;

    if (currentTask.statistics) {
        fillStatistics(currentTask.statistics);
        return;
    }

    if (currentTask.hasPrediction) {
        fetch(`${REPORT_API_BASE}/api/statistics/${currentTask.fileId}`)
            .then((res) => {
                if (!res.ok) {
                    throw new Error('读取统计结果失败');
                }
                return res.json();
            })
            .then((data) => {
                const nextTask = window.TaskState.write({
                    statistics: data.statistics,
                    alerts: data.alerts,
                    inspection: data.inspection || null,
                });
                fillStatistics(nextTask.statistics);
            })
            .catch((err) => {
                renderEmptyState(err.message);
            });
        return;
    }

    renderEmptyState('当前任务尚未完成语义分割');
}

function fillStatistics(statistics) {
    const nonZeroClassStats = (statistics.class_stats || []).filter((item) => Number(item.count) > 0);
    const nonZeroBusinessStats = (statistics.business_stats || []).filter((item) => Number(item.count) > 0);

    totalPointsEl.textContent = (statistics.total_points || 0).toLocaleString();
    classCountEl.textContent = nonZeroClassStats.length;
    businessCountEl.textContent = nonZeroBusinessStats.length;
    taskStateEl.textContent = currentTask?.hasPrediction ? '已完成' : '待分析';

    classStatsList.innerHTML = nonZeroClassStats.map((item) => `
        <div class="stack-row">
            <span>${item.name_cn} (${item.name})</span>
            <strong>${item.count.toLocaleString()} / ${item.ratio}%</strong>
        </div>
    `).join('') || '<div class="empty-copy">暂无数据</div>';

    businessStatsList.innerHTML = nonZeroBusinessStats.map((item) => `
        <div class="stack-row">
            <span>${item.name}</span>
            <strong>${item.count.toLocaleString()} / ${item.ratio}%</strong>
        </div>
    `).join('') || '<div class="empty-copy">暂无数据</div>';
}

function exportCurrent(format) {
    if (!currentTask || !currentTask.fileId || !currentTask.hasPrediction) {
        alert('当前没有可导出的分析结果');
        return;
    }
    window.open(`${REPORT_API_BASE}/api/export/${currentTask.fileId}?format=${format}`, '_blank');
}

function exportInspectionReport(format) {
    if (!currentTask || !currentTask.fileId || !currentTask.hasPrediction) {
        alert('当前没有可生成的巡检报告');
        return;
    }
    window.open(`${REPORT_API_BASE}/api/inspection-report/${currentTask.fileId}?format=${format}`, '_blank');
}

function renderEmptyState(message = '暂无可展示的统计结果') {
    taskCard.innerHTML = `
        <div class="sidebar-label">当前任务</div>
        <div class="sidebar-value">未分析</div>
        <div class="sidebar-text">${message}</div>
    `;
    totalPointsEl.textContent = '-';
    classCountEl.textContent = '-';
    businessCountEl.textContent = '-';
    taskStateEl.textContent = '-';
    classStatsList.innerHTML = '<div class="empty-copy">暂无数据</div>';
    businessStatsList.innerHTML = '<div class="empty-copy">暂无数据</div>';
}
