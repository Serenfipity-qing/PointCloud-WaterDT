const SECURITY_API_BASE = window.WATER_TWIN_API || '';

const totalUsersEl = document.getElementById('securityTotalUsers');
const adminCountEl = document.getElementById('securityAdminCount');
const frozenCountEl = document.getElementById('securityFrozenCount');
const abnormalCountEl = document.getElementById('securityAbnormalCount');
const logsEl = document.getElementById('securityLogs');
const usersEl = document.getElementById('securityUsers');
const btnClearAllLogs = document.getElementById('btnClearAllLogs');
const createUserForm = document.getElementById('adminCreateUserForm');
const createUserErrorEl = document.getElementById('adminCreateUserError');

loadSecurityOverview();
bindSecurityActions();

async function loadSecurityOverview() {
    try {
        const res = await fetch(`${SECURITY_API_BASE}/api/auth/security-overview`, {
            credentials: 'include',
        });
        if (!res.ok) {
            throw new Error('读取安全信息失败');
        }
        const data = await res.json();
        renderOverview(data);
    } catch (err) {
        if (logsEl) logsEl.innerHTML = `<div class="empty-copy">${err.message || '读取失败'}</div>`;
    }
}

function renderOverview(data) {
    if (totalUsersEl) {
        totalUsersEl.textContent = String(data.summary?.total_users ?? 0);
    }
    if (adminCountEl) {
        adminCountEl.textContent = String(data.summary?.admin_count ?? 0);
    }
    if (frozenCountEl) {
        frozenCountEl.textContent = String(data.summary?.frozen_count ?? 0);
    }
    if (abnormalCountEl) {
        abnormalCountEl.textContent = String(data.summary?.abnormal_count ?? 0);
    }
    if (logsEl) {
        const rows = data.recent_logs || [];
        logsEl.innerHTML = rows.length ? rows.map((item) => `
            <div class="security-log security-log--${item.severity || 'normal'}">
                <div class="security-log__time">${formatDateTime(item.created_at)}</div>
                <div class="security-log__body">
                    <div class="security-log__head">
                        <strong>${escapeHtml(item.username || '-')}</strong>
                        <span class="risk-chip ${mapSeverityToChip(item.severity)}">${formatSeverity(item.severity)}</span>
                    </div>
                    <div style="font-weight:700;margin-top:4px;">${formatEventType(item.event_type)} ${item.success ? '成功' : '失败'}</div>
                    <div class="security-log__meta">IP：${escapeHtml(item.ip_address || '-')} ${item.detail ? `| ${escapeHtml(item.detail)}` : ''}</div>
                </div>
            </div>
        `).join('') : '<div class="empty-copy">暂无安全事件记录</div>';
    }
    if (usersEl) {
        const rows = data.users || [];
        usersEl.innerHTML = rows.length ? rows.map((item) => `
            <article class="security-user-card">
                <div class="security-user-card__head">
                    <div>
                        <div class="security-user-card__title">
                            ${escapeHtml(item.username)}
                            <span class="security-user-role ${item.role === 'admin' ? 'admin' : ''}">${item.role === 'admin' ? '管理员' : '普通用户'}</span>
                        </div>
                        <div class="security-user-meta">创建时间：${formatDateTime(item.created_at)}</div>
                    </div>
                    <div class="security-user-status">
                        ${item.is_frozen ? '<span class="risk-chip high">已冻结</span>' : '<span class="risk-chip low">正常</span>'}
                        ${item.is_locked ? '<span class="risk-chip medium">已锁定</span>' : ''}
                    </div>
                </div>
                <div class="security-user-meta">失败次数：${item.failed_attempts} | 上次登录：${item.last_login_at ? formatDateTime(item.last_login_at) : '-'} | IP：${escapeHtml(item.last_login_ip || '-')}</div>
                <div class="security-user-actions">
                    <button class="btn btn-outline btn-sm" data-action="freeze" data-username="${escapeHtml(item.username)}" data-frozen="${item.is_frozen ? '0' : '1'}">${item.is_frozen ? '解冻' : '冻结'}</button>
                    <button class="btn btn-outline btn-sm" data-action="unlock" data-username="${escapeHtml(item.username)}">解锁</button>
                    <button class="btn btn-outline btn-sm" data-action="clear-user-logs" data-username="${escapeHtml(item.username)}">清空日志</button>
                    <button class="btn btn-outline btn-sm" data-action="delete" data-username="${escapeHtml(item.username)}">删除</button>
                </div>
            </article>
        `).join('') : '<div class="empty-copy">暂无用户数据</div>';
    }
}

function formatEventType(type) {
    const map = {
        login_success: '登录',
        login_failed: '登录',
        login_blocked_locked: '登录',
        login_frozen: '登录',
        account_locked: '账号锁定',
        register: '注册',
        change_password: '修改密码',
        unlock_success: '账号解锁',
        unlock_failed: '账号解锁',
        admin_create_user: '管理员创建用户',
        admin_freeze_user: '管理员冻结用户',
        admin_unfreeze_user: '管理员解冻用户',
        admin_unlock_user: '管理员解锁用户',
        admin_delete_user: '管理员删除用户',
        admin_clear_logs: '管理员清理日志',
    };
    return map[type] || type;
}

function formatDateTime(value) {
    try {
        return new Date(value).toLocaleString('zh-CN');
    } catch {
        return value || '-';
    }
}

function formatSeverity(value) {
    if (value === 'high') return '高风险';
    if (value === 'medium') return '关注';
    return '正常';
}

function mapSeverityToChip(value) {
    if (value === 'high') return 'high';
    if (value === 'medium') return 'medium';
    return 'low';
}

function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#039;',
        '"': '&quot;',
    }[char]));
}

function bindSecurityActions() {
    btnClearAllLogs?.addEventListener('click', async () => {
        if (!confirm('确认清空全部审计日志？')) return;
        await postSecurityAction('/api/auth/admin/logs/clear', {});
    });

    createUserForm?.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!createUserForm || !createUserErrorEl) return;
        createUserErrorEl.textContent = '';
        const formData = new FormData(createUserForm);
        try {
            await postSecurityAction('/api/auth/admin/users', {
                username: String(formData.get('username') || '').trim(),
                password: String(formData.get('password') || ''),
                role: String(formData.get('role') || 'user'),
            }, false);
            createUserForm.reset();
            createUserErrorEl.style.color = 'var(--success)';
            createUserErrorEl.textContent = '用户创建成功';
            await loadSecurityOverview();
        } catch (err) {
            createUserErrorEl.style.color = 'var(--danger)';
            createUserErrorEl.textContent = err.message || '创建失败';
        }
    });

    usersEl?.addEventListener('click', async (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        const action = target.dataset.action;
        const username = target.dataset.username;
        if (!action || !username) return;
        try {
            if (action === 'freeze') {
                await postSecurityAction('/api/auth/admin/users/freeze', {
                    username,
                    frozen: target.dataset.frozen === '1',
                });
            } else if (action === 'unlock') {
                await postSecurityAction('/api/auth/admin/users/unlock', { username });
            } else if (action === 'delete') {
                if (!confirm(`确认删除用户 ${username}？`)) return;
                await postSecurityAction('/api/auth/admin/users/delete', { username });
            } else if (action === 'clear-user-logs') {
                if (!confirm(`确认清空用户 ${username} 的审计日志？`)) return;
                await postSecurityAction('/api/auth/admin/logs/clear', { username });
            }
        } catch (err) {
            alert(err.message || '操作失败');
        }
    });
}

async function postSecurityAction(path, payload, autoReload = true) {
    const res = await fetch(`${SECURITY_API_BASE}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
    });
    if (!res.ok) {
        const error = await res.json().catch(() => ({ detail: '操作失败' }));
        throw new Error(error.detail || '操作失败');
    }
    if (autoReload) {
        await loadSecurityOverview();
    }
    return res.json().catch(() => ({}));
}
