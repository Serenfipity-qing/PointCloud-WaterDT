const recentTaskCard = document.getElementById('recentTaskCard');
const task = window.TaskState?.read?.();

if (task && recentTaskCard) {
    const updatedAt = task.updatedAt ? new Date(task.updatedAt).toLocaleString('zh-CN') : '未知';
    recentTaskCard.innerHTML = `
        <div class="sidebar-label">最近任务</div>
        <div class="sidebar-value">${task.filename || task.fileId || '未命名任务'}</div>
        <div class="sidebar-text">文件 ID：${task.fileId || '-'}</div>
        <div class="sidebar-text">是否完成分割：${task.hasPrediction ? '是' : '否'}</div>
        <div class="sidebar-text">最近更新时间：${updatedAt}</div>
    `;
}
